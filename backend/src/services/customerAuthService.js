const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const pool = require('../config/db');
const P = require('../config/prefix');
const env = require('../config/env');

const {
  verifyPassword,
  hashPassword,
} = require('../utils/password');

const {
  parseCapabilities,
  serializeCapabilities,
} = require('../utils/php');

const {
  upsertUserMeta,
} = require('../utils/meta');

const {
  withTransaction,
} = require('../utils/transaction');

const {
  slugify,
  nowLocal,
  nowGmt,
} = require('../utils/datetime');

const {
  httpError,
} = require('../utils/httpError');

const {
  sendPasswordEmail,
} = require('./mailService');

const CUSTOMER_CART_META =
  "brassleaf_customer_cart";


function hashToken(token) {
  return crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');
}

async function findCustomerByEmail(email) {
  const [rows] = await pool.query(
    `
      SELECT
        u.ID,
        u.user_login,
        u.user_email,
        u.user_pass,
        u.display_name,
        u.user_status,
        u.user_activation_key,

        cap.meta_value AS capabilities,
        fn.meta_value AS first_name,
        ln.meta_value AS last_name

      FROM ${P}users u

      LEFT JOIN ${P}usermeta cap
        ON cap.user_id = u.ID
        AND cap.meta_key = '${P}capabilities'

      LEFT JOIN ${P}usermeta fn
        ON fn.user_id = u.ID
        AND fn.meta_key = 'first_name'

      LEFT JOIN ${P}usermeta ln
        ON ln.user_id = u.ID
        AND ln.meta_key = 'last_name'

      WHERE
        LOWER(u.user_email) = LOWER(?)

      LIMIT 1
    `,
    [email]
  );

  return rows[0] || null;
}

async function makeUniqueUsername(
  conn,
  email
) {
  const emailName =
    String(email)
      .split('@')[0]
      .replace(
        /[^a-zA-Z0-9._-]/g,
        ''
      )
      .toLowerCase();

  const base =
    emailName ||
    `customer${Date.now()}`;

  let username = base;
  let count = 1;

  while (true) {
    const [rows] =
      await conn.query(
        `
          SELECT ID
          FROM ${P}users
          WHERE user_login = ?
          LIMIT 1
        `,
        [username]
      );

    if (!rows.length) {
      return username;
    }

    username =
      `${base}${count}`;

    count += 1;
  }
}

async function createPasswordToken(
  user,
  purpose
) {
  const token = jwt.sign(
    {
      userId: user.ID,
      email: user.user_email,
      purpose,
    },
    env.jwtSecret,
    {
      expiresIn: '30m',
    }
  );

  const tokenHash =
    hashToken(token);

  const activationValue =
    `${purpose}:${tokenHash}`;

  await pool.query(
    `
      UPDATE ${P}users
      SET user_activation_key = ?
      WHERE ID = ?
    `,
    [
      activationValue,
      user.ID,
    ]
  );

  return token;
}

async function register({
  firstName,
  lastName,
  email,
}) {
  const first =
    String(
      firstName || ''
    ).trim();

  const last =
    String(
      lastName || ''
    ).trim();

  const cleanEmail =
    String(
      email || ''
    )
      .trim()
      .toLowerCase();

  if (
    !first ||
    !last ||
    !cleanEmail
  ) {
    throw httpError(
      400,
      'First name, last name and email are required'
    );
  }

  // const existing =
  //   await findCustomerByEmail(
  //     cleanEmail
  //   );

  // if (existing) {
  //   throw httpError(
  //     409,
  //     'Account already exists with this email'
  //   );
  // }
  const existing =
  await findCustomerByEmail(
    cleanEmail
  );

if (existing) {
  const roles =
    parseCapabilities(
      existing.capabilities
    );

  const activationKey =
    String(
      existing.user_activation_key || ''
    );

  const waitingForPassword =
    activationKey.startsWith(
      'set-password:'
    );

  if (
    roles.includes('customer') &&
    waitingForPassword
  ) {
    const token =
      await createPasswordToken(
        existing,
        'set-password'
      );

    await sendPasswordEmail({
      email:
        existing.user_email,

      firstName:
        existing.first_name ||
        first,

      token,

      mode:
        'set',
    });

    return {
      ok: true,

      userId:
        existing.ID,

      message:
        'Account already created. A new set-password link has been sent to your email.',
    };
  }

  throw httpError(
    409,
    'Account already exists with this email'
  );
}

  const userId =
    await withTransaction(
      pool,
      async (conn) => {
        const username =
          await makeUniqueUsername(
            conn,
            cleanEmail
          );

        const displayName =
          `${first} ${last}`.trim();

        const randomPassword =
          crypto
            .randomBytes(32)
            .toString('hex');

        const passwordHash =
          hashPassword(
            randomPassword
          );

        const registered =
          nowLocal();

        const [userResult] =
          await conn.query(
            `
              INSERT INTO ${P}users
              (
                user_login,
                user_pass,
                user_nicename,
                user_email,
                user_url,
                user_registered,
                user_activation_key,
                user_status,
                display_name
              )
              VALUES
              (?, ?, ?, ?, '', ?, '', 0, ?)
            `,
            [
              username,
              passwordHash,
              slugify(username),
              cleanEmail,
              registered,
              displayName,
            ]
          );

        const id =
          userResult.insertId;

        const caps =
          serializeCapabilities(
            ['customer']
          );

        await upsertUserMeta(
          conn,
          P,
          id,
          'nickname',
          username
        );

        await upsertUserMeta(
          conn,
          P,
          id,
          'first_name',
          first
        );

        await upsertUserMeta(
          conn,
          P,
          id,
          'last_name',
          last
        );

        // await upsertUserMeta(
        //   conn,
        //   P,
        //   id,
        //   'wpwd_capabilities',
        //   caps
        // );
        await upsertUserMeta(
  conn,
  P,
  id,
  `${P}capabilities`,
  caps
);

        await upsertUserMeta(
          conn,
          P,
          id,
          `${P}user_level`,
          '0'
        );

        await upsertUserMeta(
          conn,
          P,
          id,
          'billing_first_name',
          first
        );

        await upsertUserMeta(
          conn,
          P,
          id,
          'billing_last_name',
          last
        );

        await upsertUserMeta(
          conn,
          P,
          id,
          'billing_email',
          cleanEmail
        );

        await conn.query(
          `
            INSERT INTO ${P}wc_customer_lookup
            (
              user_id,
              username,
              first_name,
              last_name,
              email,
              date_last_active,
              date_registered,
              country,
              postcode,
              city,
              state
            )
            VALUES
            (?, ?, ?, ?, ?, ?, ?, '', '', '', '')
          `,
          [
            id,
            username,
            first,
            last,
            cleanEmail,
            nowGmt(),
            registered,
          ]
        );

        return id;
      }
    );

  const user =
    await findCustomerByEmail(
      cleanEmail
    );

  const token =
    await createPasswordToken(
      user,
      'set-password'
    );

  await sendPasswordEmail({
    email:
      cleanEmail,

    firstName:
      first,

    token,

    mode:
      'set',
  });

  return {
    ok: true,

    userId,

    message:
      'Account created. Please check your email to set your password.',
  };
}

async function login({
  email,
  password,
}) {
  const cleanEmail =
    String(
      email || ''
    )
      .trim()
      .toLowerCase();

  if (
    !cleanEmail ||
    !password
  ) {
    throw httpError(
      400,
      'Email and password are required'
    );
  }

  const user =
    await findCustomerByEmail(
      cleanEmail
    );

  if (!user) {
    throw httpError(
      401,
      'Invalid email or password'
    );
  }

  const roles =
    parseCapabilities(
      user.capabilities
    );

  if (
    !roles.includes('customer')
  ) {
    throw httpError(
      403,
      'Customer account required'
    );
  }

  // if (
  //   user.user_activation_key
  // ) {
  //   throw httpError(
  //     403,
  //     'Please set your password using the link sent to your email'
  //   );
  // }
  const activationKey =
  String(
    user.user_activation_key || ''
  );

if (
  activationKey.startsWith(
    'set-password:'
  )
) {
  throw httpError(
    403,
    'Please set your password using the link sent to your email'
  );
}

  if (
    !verifyPassword(
      password,
      user.user_pass
    )
  ) {
    throw httpError(
      401,
      'Invalid email or password'
    );
  }

  const token = jwt.sign(
    {
      id: user.ID,
      login: user.user_login,
      email: user.user_email,
      roles,
      type: 'customer',
    },
    env.jwtSecret,
    {
      expiresIn:
        env.jwtExpiresIn,
    }
  );

  return {
    token,

    user: {
      id:
        user.ID,

      login:
        user.user_login,

      email:
        user.user_email,

      firstName:
        user.first_name || '',

      lastName:
        user.last_name || '',

      displayName:
        user.display_name,

      roles,
    },
  };
}

async function checkCustomerEmail(
  email
) {
  const cleanEmail =
    String(email || "")
      .trim()
      .toLowerCase();

  if (!cleanEmail) {
    throw httpError(
      400,
      "Email is required"
    );
  }

  const user =
    await findCustomerByEmail(
      cleanEmail
    );

  if (!user) {
    return {
      exists: false,
    };
  }

  const roles =
    parseCapabilities(
      user.capabilities
    );

  return {
    exists:
      roles.includes(
        "customer"
      ),
  };
}

async function registerFromCheckout({
  firstName,
  lastName,
  email,
  password,
}) {
  const first =
    String(
      firstName || ""
    ).trim();

  const last =
    String(
      lastName || ""
    ).trim();

  const cleanEmail =
    String(
      email || ""
    )
      .trim()
      .toLowerCase();

  const cleanPassword =
    String(
      password || ""
    );

  if (
    !first ||
    !last ||
    !cleanEmail ||
    !cleanPassword
  ) {
    throw httpError(
      400,
      "First name, last name, email and password are required"
    );
  }

  if (
    cleanPassword.length < 8
  ) {
    throw httpError(
      400,
      "Password must be at least 8 characters"
    );
  }

  /*
   * Existing email cannot create
   * another customer.
   */
  const existing =
    await findCustomerByEmail(
      cleanEmail
    );

  if (existing) {
    throw httpError(
      409,
      "An account is already registered with your email address. Please log in."
    );
  }

  const userId =
    await withTransaction(
      pool,
      async (conn) => {
        const username =
          await makeUniqueUsername(
            conn,
            cleanEmail
          );

        const displayName =
          `${first} ${last}`
            .trim();

        const passwordHash =
          hashPassword(
            cleanPassword
          );

        const registered =
          nowLocal();

        const [userResult] =
          await conn.query(
            `
              INSERT INTO ${P}users
              (
                user_login,
                user_pass,
                user_nicename,
                user_email,
                user_url,
                user_registered,
                user_activation_key,
                user_status,
                display_name
              )
              VALUES
              (?, ?, ?, ?, '', ?, '', 0, ?)
            `,
            [
              username,
              passwordHash,
              slugify(username),
              cleanEmail,
              registered,
              displayName,
            ]
          );

        const id =
          userResult.insertId;

        const caps =
          serializeCapabilities(
            ["customer"]
          );

        await upsertUserMeta(
          conn,
          P,
          id,
          "nickname",
          username
        );

        await upsertUserMeta(
          conn,
          P,
          id,
          "first_name",
          first
        );

        await upsertUserMeta(
          conn,
          P,
          id,
          "last_name",
          last
        );

        await upsertUserMeta(
          conn,
          P,
          id,
          `${P}capabilities`,
          caps
        );

        await upsertUserMeta(
          conn,
          P,
          id,
          `${P}user_level`,
          "0"
        );

        await upsertUserMeta(
          conn,
          P,
          id,
          "billing_first_name",
          first
        );

        await upsertUserMeta(
          conn,
          P,
          id,
          "billing_last_name",
          last
        );

        await upsertUserMeta(
          conn,
          P,
          id,
          "billing_email",
          cleanEmail
        );

        await conn.query(
          `
            INSERT INTO
              ${P}wc_customer_lookup
            (
              user_id,
              username,
              first_name,
              last_name,
              email,
              date_last_active,
              date_registered,
              country,
              postcode,
              city,
              state
            )
            VALUES
            (?, ?, ?, ?, ?, ?, ?, '', '', '', '')
          `,
          [
            id,
            username,
            first,
            last,
            cleanEmail,
            nowGmt(),
            registered,
          ]
        );

        return id;
      }
    );

  /*
   * Since checkout customer already
   * supplied password, login directly.
   */
  return login({
    email:
      cleanEmail,

    password:
      cleanPassword,
  });
}

async function forgotPassword(email) {
  const cleanEmail =
    String(
      email || ''
    )
      .trim()
      .toLowerCase();

  if (!cleanEmail) {
    throw httpError(
      400,
      'Email is required'
    );
  }

  const user =
    await findCustomerByEmail(
      cleanEmail
    );

  const genericMessage =
    'If an account exists for this email, a password reset link has been sent.';

  if (!user) {
    return {
      ok: true,
      message: genericMessage,
    };
  }

  const roles =
    parseCapabilities(
      user.capabilities
    );

  if (
    !roles.includes('customer')
  ) {
    return {
      ok: true,
      message: genericMessage,
    };
  }

  const token =
    await createPasswordToken(
      user,
      'reset-password'
    );

  await sendPasswordEmail({
    email:
      user.user_email,

    firstName:
      user.first_name || '',

    token,

    mode:
      'reset',
  });

  return {
    ok: true,
    message: genericMessage,
  };
}

async function setPassword({
  token,
  password,
  confirmPassword,
}) {
  if (
    !token ||
    !password ||
    !confirmPassword
  ) {
    throw httpError(
      400,
      'Token, password and confirm password are required'
    );
  }

  if (
    password !==
    confirmPassword
  ) {
    throw httpError(
      400,
      'Passwords do not match'
    );
  }

  if (
    String(password).length < 8
  ) {
    throw httpError(
      400,
      'Password must be at least 8 characters'
    );
  }

  let payload;

  try {
    payload =
      jwt.verify(
        token,
        env.jwtSecret
      );
  } catch {
    throw httpError(
      400,
      'Password link is invalid or expired'
    );
  }

  if (
    payload.purpose !==
      'set-password' &&
    payload.purpose !==
      'reset-password'
  ) {
    throw httpError(
      400,
      'Invalid password link'
    );
  }

  const [[user]] =
    await pool.query(
      `
        SELECT
          ID,
          user_email,
          user_activation_key
        FROM ${P}users
        WHERE ID = ?
        LIMIT 1
      `,
      [payload.userId]
    );

  if (!user) {
    throw httpError(
      404,
      'User not found'
    );
  }

  if (
    String(user.user_email)
      .toLowerCase() !==
    String(payload.email)
      .toLowerCase()
  ) {
    throw httpError(
      400,
      'Invalid password link'
    );
  }

  // const expected =
  //   hashToken(token);

  // if (
  //   !user.user_activation_key ||
  //   user.user_activation_key !==
  //     expected
  // ) {
  //   throw httpError(
  //     400,
  //     'Password link has already been used or is invalid'
  //   );
  // }
  const expectedHash =
  hashToken(token);

const expectedActivationValue =
  `${payload.purpose}:${expectedHash}`;

const storedActivationValue =
  String(
    user.user_activation_key || ''
  );

const legacyTokenValid =
  storedActivationValue ===
  expectedHash;

const newTokenValid =
  storedActivationValue ===
  expectedActivationValue;

if (
  !legacyTokenValid &&
  !newTokenValid
) {
  throw httpError(
    400,
    'Password link has already been used or is invalid'
  );
}

  const hash =
    hashPassword(password);

  await pool.query(
    `
      UPDATE ${P}users
      SET
        user_pass = ?,
        user_activation_key = ''
      WHERE ID = ?
    `,
    [
      hash,
      user.ID,
    ]
  );
return {
  ok: true,

  message:
    payload.purpose ===
    'reset-password'
      ? 'Password reset successfully. Please login with your new password.'
      : 'Password created successfully. Please login.',
};
  // return {
  //   ok: true,

  //   message:
  //     'Password created successfully. Please login.',
  // };
}


// async function getMe(
//   userId
// ) {
//   const [[user]] =
//     await pool.query(
//       `
//         SELECT
//           u.ID,
//           u.user_login,
//           u.user_email,
//           u.display_name,

//           fn.meta_value AS first_name,
//           ln.meta_value AS last_name,
//           phone.meta_value AS phone

//         FROM ${P}users u

//         LEFT JOIN ${P}usermeta fn
//           ON fn.user_id = u.ID
//           AND fn.meta_key = 'first_name'

//         LEFT JOIN ${P}usermeta ln
//           ON ln.user_id = u.ID
//           AND ln.meta_key = 'last_name'

//         LEFT JOIN ${P}usermeta phone
//           ON phone.user_id = u.ID
//           AND phone.meta_key = 'billing_phone'

//         WHERE u.ID = ?

//         LIMIT 1
//       `,
//       [userId]
//     );

//   if (!user) {
//     throw httpError(
//       404,
//       "Customer not found"
//     );
//   }

//   return {
//     id: user.ID,

//     login:
//       user.user_login,

//     email:
//       user.user_email,

//     firstName:
//       user.first_name || "",

//     lastName:
//       user.last_name || "",

//     displayName:
//       user.display_name || "",

//     phone:
//       user.phone || "",
//   };
// }
async function getMe(
  userId
) {
  const [[user]] =
    await pool.query(
      `
        SELECT
          ID,
          user_login,
          user_email,
          display_name
        FROM ${P}users
        WHERE ID = ?
        LIMIT 1
      `,
      [userId]
    );

  if (!user) {
    throw httpError(
      404,
      "Customer not found"
    );
  }

  const [metaRows] =
    await pool.query(
      `
        SELECT
          meta_key,
          meta_value
        FROM ${P}usermeta
        WHERE user_id = ?
      `,
      [userId]
    );

  const meta =
    Object.fromEntries(
      metaRows.map(
        (row) => [
          row.meta_key,
          row.meta_value,
        ]
      )
    );

  return {
    id:
      user.ID,

    login:
      user.user_login,

    email:
      user.user_email,

    firstName:
      meta.first_name || "",

    lastName:
      meta.last_name || "",

    displayName:
      user.display_name || "",

    phone:
      meta.billing_phone || "",

    billingAddress: {
      firstName:
        meta.billing_first_name ||
        meta.first_name ||
        "",

      lastName:
        meta.billing_last_name ||
        meta.last_name ||
        "",
       company:
    meta.billing_company ||
    "",

      email:
        meta.billing_email ||
        user.user_email ||
        "",

      phone:
        meta.billing_phone ||
        "",

      address1:
        meta.billing_address_1 ||
        "",

      address2:
        meta.billing_address_2 ||
        "",

      city:
        meta.billing_city ||
        "",

      state:
        meta.billing_state ||
        "",

      postcode:
        meta.billing_postcode ||
        "",

      country:
        meta.billing_country ||
        "IN",

      studentClass:
        meta.billing_student_class ||
        "",

      admissionNo:
        meta.billing_admission_no ||
        "",

      parentName:
        meta.billing_parent_name ||
        "",
    },
  };
}
async function updateMe(
  userId,
  data = {}
) {
  const firstName =
    String(
      data.firstName || ""
    ).trim();

  const lastName =
    String(
      data.lastName || ""
    ).trim();

  const email =
    String(
      data.email || ""
    )
      .trim()
      .toLowerCase();

  const displayName =
    String(
      data.displayName ||
        `${firstName} ${lastName}`
    ).trim();

  if (
    !firstName ||
    !lastName ||
    !email
  ) {
    throw httpError(
      400,
      "First name, last name and email are required"
    );
  }

  const [[duplicate]] =
    await pool.query(
      `
        SELECT ID
        FROM ${P}users

        WHERE
          LOWER(user_email)
            = LOWER(?)

          AND ID <> ?

        LIMIT 1
      `,
      [
        email,
        userId,
      ]
    );

  if (duplicate) {
    throw httpError(
      409,
      "Email address is already registered."
    );
  }

  await pool.query(
    `
      UPDATE ${P}users

      SET
        user_email = ?,
        display_name = ?

      WHERE ID = ?
    `,
    [
      email,
      displayName,
      userId,
    ]
  );

  const billing =
    data.billingAddress ||
    {};

  const meta = {
    first_name:
      firstName,

    last_name:
      lastName,

    billing_first_name:
      billing.firstName ??
      firstName,

    billing_last_name:
      billing.lastName ??
      lastName,

      billing_company:
  billing.company ??
  "",

    billing_email:
      billing.email ??
      email,

    billing_phone:
      billing.phone ??
      "",

    billing_address_1:
      billing.address1 ??
      "",

    billing_address_2:
      billing.address2 ??
      "",

    billing_city:
      billing.city ??
      "",

    billing_state:
      billing.state ??
      "",

    billing_postcode:
      billing.postcode ??
      "",

    billing_country:
      billing.country ??
      "IN",

    billing_student_class:
      billing.studentClass ??
      "",

    billing_admission_no:
      billing.admissionNo ??
      "",

    billing_parent_name:
      billing.parentName ??
      "",
  };

  for (
    const [
      key,
      value,
    ] of Object.entries(meta)
  ) {
    await upsertUserMeta(
      pool,
      P,
      userId,
      key,
      value
    );
  }

  await pool.query(
    `
      UPDATE
        ${P}wc_customer_lookup

      SET
        first_name = ?,
        last_name = ?,
        email = ?,
        country = ?,
        postcode = ?,
        city = ?,
        state = ?

      WHERE user_id = ?
    `,
    [
      firstName,
      lastName,
      email,

      billing.country ||
        "IN",

      billing.postcode ||
        "",

      billing.city ||
        "",

      billing.state ||
        "",

      userId,
    ]
  );

  return getMe(
    userId
  );
}
async function changePassword({
  userId,
  currentPassword,
  newPassword,
  confirmPassword,
}) {
  if (
    !currentPassword ||
    !newPassword ||
    !confirmPassword
  ) {
    throw httpError(
      400,
      "Current password, new password and confirm password are required"
    );
  }

  if (
    newPassword !==
    confirmPassword
  ) {
    throw httpError(
      400,
      "New password and confirm password do not match"
    );
  }

  if (
    String(newPassword)
      .length < 8
  ) {
    throw httpError(
      400,
      "New password must be at least 8 characters"
    );
  }

  const [[user]] =
    await pool.query(
      `
        SELECT
          ID,
          user_pass
        FROM ${P}users
        WHERE ID = ?
        LIMIT 1
      `,
      [userId]
    );

  if (!user) {
    throw httpError(
      404,
      "Customer not found"
    );
  }

  /*
   * Check OLD password
   */
  const oldPasswordCorrect =
    verifyPassword(
      currentPassword,
      user.user_pass
    );

  if (!oldPasswordCorrect) {
    throw httpError(
      400,
      "Current password is incorrect"
    );
  }

  /*
   * Do not allow same password
   */
  const samePassword =
    verifyPassword(
      newPassword,
      user.user_pass
    );

  if (samePassword) {
    throw httpError(
      400,
      "New password must be different from your current password"
    );
  }

  const newHash =
    hashPassword(
      newPassword
    );

  await pool.query(
    `
      UPDATE ${P}users
      SET user_pass = ?
      WHERE ID = ?
    `,
    [
      newHash,
      userId,
    ]
  );

  return {
    ok: true,

    message:
      "Password changed successfully.",
  };
}

async function getCart(
  userId
) {
  const [rows] =
    await pool.query(
      `
        SELECT meta_value
        FROM ${P}usermeta
        WHERE
          user_id = ?
          AND meta_key = ?
        LIMIT 1
      `,
      [
        userId,
        CUSTOMER_CART_META,
      ]
    );

  if (!rows.length) {
    return {
      items: [],
    };
  }

  try {
    const parsed =
      JSON.parse(
        rows[0].meta_value ||
          "[]"
      );

    return {
      items:
        Array.isArray(parsed)
          ? parsed
          : [],
    };
  } catch {
    return {
      items: [],
    };
  }
}

async function saveCart(
  userId,
  items
) {
  const safeItems =
    Array.isArray(items)
      ? items
      : [];

  await upsertUserMeta(
    pool,
    P,
    userId,
    CUSTOMER_CART_META,
    JSON.stringify(safeItems)
  );

  return {
    ok: true,
    items: safeItems,
  };
}

async function clearCustomerCart(
  userId
) {
  await upsertUserMeta(
    pool,
    P,
    userId,
    CUSTOMER_CART_META,
    JSON.stringify([])
  );

  return {
    ok: true,
    items: [],
  };
}
// module.exports = {
//   register,
//   login,
//   forgotPassword,
//   setPassword,
// };
module.exports = {
  register,
  login,

  forgotPassword,
  setPassword,

  getMe,
  updateMe,

  changePassword,

  checkCustomerEmail,
  registerFromCheckout,

  getCart,
  saveCart,
  clearCustomerCart,
};



// const crypto = require('crypto');
// const jwt = require('jsonwebtoken');

// const pool = require('../config/db');
// const P = require('../config/prefix');
// const env = require('../config/env');

// const {
//   verifyPassword,
//   hashPassword,
// } = require('../utils/password');

// const {
//   parseCapabilities,
//   serializeCapabilities,
// } = require('../utils/php');

// const {
//   upsertUserMeta,
// } = require('../utils/meta');

// const {
//   withTransaction,
// } = require('../utils/transaction');

// const {
//   slugify,
//   nowLocal,
//   nowGmt,
// } = require('../utils/datetime');

// const {
//   httpError,
// } = require('../utils/httpError');

// const {
//   sendPasswordEmail,
// } = require('./mailService');

// function hashToken(token) {
//   return crypto
//     .createHash('sha256')
//     .update(token)
//     .digest('hex');
// }

// async function findCustomerByEmail(email) {
//   const [rows] = await pool.query(
//     `
//       SELECT
//         u.ID,
//         u.user_login,
//         u.user_email,
//         u.user_pass,
//         u.display_name,
//         u.user_status,
//         u.user_activation_key,

//         cap.meta_value AS capabilities,
//         fn.meta_value AS first_name,
//         ln.meta_value AS last_name

//       FROM ${P}users u

//       LEFT JOIN ${P}usermeta cap
//         ON cap.user_id = u.ID
//         AND cap.meta_key = 'wpwd_capabilities'

//       LEFT JOIN ${P}usermeta fn
//         ON fn.user_id = u.ID
//         AND fn.meta_key = 'first_name'

//       LEFT JOIN ${P}usermeta ln
//         ON ln.user_id = u.ID
//         AND ln.meta_key = 'last_name'

//       WHERE
//         LOWER(u.user_email) = LOWER(?)

//       LIMIT 1
//     `,
//     [email]
//   );

//   return rows[0] || null;
// }

// async function makeUniqueUsername(
//   conn,
//   email
// ) {
//   const emailName =
//     String(email)
//       .split('@')[0]
//       .replace(
//         /[^a-zA-Z0-9._-]/g,
//         ''
//       )
//       .toLowerCase();

//   const base =
//     emailName ||
//     `customer${Date.now()}`;

//   let username = base;
//   let count = 1;

//   while (true) {
//     const [rows] =
//       await conn.query(
//         `
//           SELECT ID
//           FROM ${P}users
//           WHERE user_login = ?
//           LIMIT 1
//         `,
//         [username]
//       );

//     if (!rows.length) {
//       return username;
//     }

//     username =
//       `${base}${count}`;

//     count += 1;
//   }
// }

// async function createPasswordToken(
//   user,
//   purpose
// ) {
//   const token = jwt.sign(
//     {
//       userId: user.ID,
//       email: user.user_email,
//       purpose,
//     },
//     env.jwtSecret,
//     {
//       expiresIn: '30m',
//     }
//   );

//   const tokenHash =
//     hashToken(token);

//   const activationValue =
//     `${purpose}:${tokenHash}`;

//   await pool.query(
//     `
//       UPDATE ${P}users
//       SET user_activation_key = ?
//       WHERE ID = ?
//     `,
//     [
//       activationValue,
//       user.ID,
//     ]
//   );

//   return token;
// }

// async function register({
//   firstName,
//   lastName,
//   email,
// }) {
//   const first =
//     String(
//       firstName || ''
//     ).trim();

//   const last =
//     String(
//       lastName || ''
//     ).trim();

//   const cleanEmail =
//     String(
//       email || ''
//     )
//       .trim()
//       .toLowerCase();

//   if (
//     !first ||
//     !last ||
//     !cleanEmail
//   ) {
//     throw httpError(
//       400,
//       'First name, last name and email are required'
//     );
//   }

//   // const existing =
//   //   await findCustomerByEmail(
//   //     cleanEmail
//   //   );

//   // if (existing) {
//   //   throw httpError(
//   //     409,
//   //     'Account already exists with this email'
//   //   );
//   // }
//   const existing =
//   await findCustomerByEmail(
//     cleanEmail
//   );

// if (existing) {
//   const roles =
//     parseCapabilities(
//       existing.capabilities
//     );

//   const activationKey =
//     String(
//       existing.user_activation_key || ''
//     );

//   const waitingForPassword =
//     activationKey.startsWith(
//       'set-password:'
//     );

//   if (
//     roles.includes('customer') &&
//     waitingForPassword
//   ) {
//     const token =
//       await createPasswordToken(
//         existing,
//         'set-password'
//       );

//     await sendPasswordEmail({
//       email:
//         existing.user_email,

//       firstName:
//         existing.first_name ||
//         first,

//       token,

//       mode:
//         'set',
//     });

//     return {
//       ok: true,

//       userId:
//         existing.ID,

//       message:
//         'Account already created. A new set-password link has been sent to your email.',
//     };
//   }

//   throw httpError(
//     409,
//     'Account already exists with this email'
//   );
// }

//   const userId =
//     await withTransaction(
//       pool,
//       async (conn) => {
//         const username =
//           await makeUniqueUsername(
//             conn,
//             cleanEmail
//           );

//         const displayName =
//           `${first} ${last}`.trim();

//         const randomPassword =
//           crypto
//             .randomBytes(32)
//             .toString('hex');

//         const passwordHash =
//           hashPassword(
//             randomPassword
//           );

//         const registered =
//           nowLocal();

//         const [userResult] =
//           await conn.query(
//             `
//               INSERT INTO ${P}users
//               (
//                 user_login,
//                 user_pass,
//                 user_nicename,
//                 user_email,
//                 user_url,
//                 user_registered,
//                 user_activation_key,
//                 user_status,
//                 display_name
//               )
//               VALUES
//               (?, ?, ?, ?, '', ?, '', 0, ?)
//             `,
//             [
//               username,
//               passwordHash,
//               slugify(username),
//               cleanEmail,
//               registered,
//               displayName,
//             ]
//           );

//         const id =
//           userResult.insertId;

//         const caps =
//           serializeCapabilities(
//             ['customer']
//           );

//         await upsertUserMeta(
//           conn,
//           P,
//           id,
//           'nickname',
//           username
//         );

//         await upsertUserMeta(
//           conn,
//           P,
//           id,
//           'first_name',
//           first
//         );

//         await upsertUserMeta(
//           conn,
//           P,
//           id,
//           'last_name',
//           last
//         );

//         await upsertUserMeta(
//           conn,
//           P,
//           id,
//           'wpwd_capabilities',
//           caps
//         );

//         await upsertUserMeta(
//           conn,
//           P,
//           id,
//           'wpwd_user_level',
//           '0'
//         );

//         await upsertUserMeta(
//           conn,
//           P,
//           id,
//           'billing_first_name',
//           first
//         );

//         await upsertUserMeta(
//           conn,
//           P,
//           id,
//           'billing_last_name',
//           last
//         );

//         await upsertUserMeta(
//           conn,
//           P,
//           id,
//           'billing_email',
//           cleanEmail
//         );

//         await conn.query(
//           `
//             INSERT INTO ${P}wc_customer_lookup
//             (
//               user_id,
//               username,
//               first_name,
//               last_name,
//               email,
//               date_last_active,
//               date_registered,
//               country,
//               postcode,
//               city,
//               state
//             )
//             VALUES
//             (?, ?, ?, ?, ?, ?, ?, '', '', '', '')
//           `,
//           [
//             id,
//             username,
//             first,
//             last,
//             cleanEmail,
//             nowGmt(),
//             registered,
//           ]
//         );

//         return id;
//       }
//     );

//   const user =
//     await findCustomerByEmail(
//       cleanEmail
//     );

//   const token =
//     await createPasswordToken(
//       user,
//       'set-password'
//     );

//   await sendPasswordEmail({
//     email:
//       cleanEmail,

//     firstName:
//       first,

//     token,

//     mode:
//       'set',
//   });

//   return {
//     ok: true,

//     userId,

//     message:
//       'Account created. Please check your email to set your password.',
//   };
// }

// async function login({
//   email,
//   password,
// }) {
//   const cleanEmail =
//     String(
//       email || ''
//     )
//       .trim()
//       .toLowerCase();

//   if (
//     !cleanEmail ||
//     !password
//   ) {
//     throw httpError(
//       400,
//       'Email and password are required'
//     );
//   }

//   const user =
//     await findCustomerByEmail(
//       cleanEmail
//     );

//   if (!user) {
//     throw httpError(
//       401,
//       'Invalid email or password'
//     );
//   }

//   const roles =
//     parseCapabilities(
//       user.capabilities
//     );

//   if (
//     !roles.includes('customer')
//   ) {
//     throw httpError(
//       403,
//       'Customer account required'
//     );
//   }

//   // if (
//   //   user.user_activation_key
//   // ) {
//   //   throw httpError(
//   //     403,
//   //     'Please set your password using the link sent to your email'
//   //   );
//   // }
//   const activationKey =
//   String(
//     user.user_activation_key || ''
//   );

// if (
//   activationKey.startsWith(
//     'set-password:'
//   )
// ) {
//   throw httpError(
//     403,
//     'Please set your password using the link sent to your email'
//   );
// }

//   if (
//     !verifyPassword(
//       password,
//       user.user_pass
//     )
//   ) {
//     throw httpError(
//       401,
//       'Invalid email or password'
//     );
//   }

//   const token = jwt.sign(
//     {
//       id: user.ID,
//       login: user.user_login,
//       email: user.user_email,
//       roles,
//       type: 'customer',
//     },
//     env.jwtSecret,
//     {
//       expiresIn:
//         env.jwtExpiresIn,
//     }
//   );

//   return {
//     token,

//     user: {
//       id:
//         user.ID,

//       login:
//         user.user_login,

//       email:
//         user.user_email,

//       firstName:
//         user.first_name || '',

//       lastName:
//         user.last_name || '',

//       displayName:
//         user.display_name,

//       roles,
//     },
//   };
// }

// async function forgotPassword(email) {
//   const cleanEmail =
//     String(
//       email || ''
//     )
//       .trim()
//       .toLowerCase();

//   if (!cleanEmail) {
//     throw httpError(
//       400,
//       'Email is required'
//     );
//   }

//   const user =
//     await findCustomerByEmail(
//       cleanEmail
//     );

//   const genericMessage =
//     'If an account exists for this email, a password reset link has been sent.';

//   if (!user) {
//     return {
//       ok: true,
//       message: genericMessage,
//     };
//   }

//   const roles =
//     parseCapabilities(
//       user.capabilities
//     );

//   if (
//     !roles.includes('customer')
//   ) {
//     return {
//       ok: true,
//       message: genericMessage,
//     };
//   }

//   const token =
//     await createPasswordToken(
//       user,
//       'reset-password'
//     );

//   await sendPasswordEmail({
//     email:
//       user.user_email,

//     firstName:
//       user.first_name || '',

//     token,

//     mode:
//       'reset',
//   });

//   return {
//     ok: true,
//     message: genericMessage,
//   };
// }

// async function setPassword({
//   token,
//   password,
//   confirmPassword,
// }) {
//   if (
//     !token ||
//     !password ||
//     !confirmPassword
//   ) {
//     throw httpError(
//       400,
//       'Token, password and confirm password are required'
//     );
//   }

//   if (
//     password !==
//     confirmPassword
//   ) {
//     throw httpError(
//       400,
//       'Passwords do not match'
//     );
//   }

//   if (
//     String(password).length < 8
//   ) {
//     throw httpError(
//       400,
//       'Password must be at least 8 characters'
//     );
//   }

//   let payload;

//   try {
//     payload =
//       jwt.verify(
//         token,
//         env.jwtSecret
//       );
//   } catch {
//     throw httpError(
//       400,
//       'Password link is invalid or expired'
//     );
//   }

//   if (
//     payload.purpose !==
//       'set-password' &&
//     payload.purpose !==
//       'reset-password'
//   ) {
//     throw httpError(
//       400,
//       'Invalid password link'
//     );
//   }

//   const [[user]] =
//     await pool.query(
//       `
//         SELECT
//           ID,
//           user_email,
//           user_activation_key
//         FROM ${P}users
//         WHERE ID = ?
//         LIMIT 1
//       `,
//       [payload.userId]
//     );

//   if (!user) {
//     throw httpError(
//       404,
//       'User not found'
//     );
//   }

//   if (
//     String(user.user_email)
//       .toLowerCase() !==
//     String(payload.email)
//       .toLowerCase()
//   ) {
//     throw httpError(
//       400,
//       'Invalid password link'
//     );
//   }

//   // const expected =
//   //   hashToken(token);

//   // if (
//   //   !user.user_activation_key ||
//   //   user.user_activation_key !==
//   //     expected
//   // ) {
//   //   throw httpError(
//   //     400,
//   //     'Password link has already been used or is invalid'
//   //   );
//   // }
//   const expectedHash =
//   hashToken(token);

// const expectedActivationValue =
//   `${payload.purpose}:${expectedHash}`;

// const storedActivationValue =
//   String(
//     user.user_activation_key || ''
//   );

// const legacyTokenValid =
//   storedActivationValue ===
//   expectedHash;

// const newTokenValid =
//   storedActivationValue ===
//   expectedActivationValue;

// if (
//   !legacyTokenValid &&
//   !newTokenValid
// ) {
//   throw httpError(
//     400,
//     'Password link has already been used or is invalid'
//   );
// }

//   const hash =
//     hashPassword(password);

//   await pool.query(
//     `
//       UPDATE ${P}users
//       SET
//         user_pass = ?,
//         user_activation_key = ''
//       WHERE ID = ?
//     `,
//     [
//       hash,
//       user.ID,
//     ]
//   );
// return {
//   ok: true,

//   message:
//     payload.purpose ===
//     'reset-password'
//       ? 'Password reset successfully. Please login with your new password.'
//       : 'Password created successfully. Please login.',
// };
//   // return {
//   //   ok: true,

//   //   message:
//   //     'Password created successfully. Please login.',
//   // };
// }

// module.exports = {
//   register,
//   login,
//   forgotPassword,
//   setPassword,
// };