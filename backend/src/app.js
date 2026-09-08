const path = require("path");
const express = require("express");
const cors = require("cors");

const env = require("./config/env");
const pool = require("./config/db");
const P = require("./config/prefix");

const errorHandler = require("./middleware/errorHandler");
const {
  ensureUploadDir,
} = require("./services/mediaService");

/* =========================================================
   EXISTING ADMIN / BACKEND ROUTES
   DO NOT CHANGE THESE ROUTE FILES
========================================================= */

const authRouter = require("./routes/auth");
const dashboardRouter = require("./routes/dashboard");

const productsRouter = require("./routes/products");
const categoriesRouter = require("./routes/categories");

const ordersRouter = require("./routes/orders");
const customersRouter = require("./routes/customers");
const paymentsRouter = require("./routes/payments");
const couponsRouter = require("./routes/coupons");
const shippingRouter = require("./routes/shipping");
const usersRouter = require("./routes/users");
const mediaRouter = require("./routes/media");
const reportsRouter = require("./routes/reports");
const inventoryRouter = require("./routes/inventory");
const gstRouter = require("./routes/gst");
const settingsRouter = require("./routes/settings");

/* =========================================================
   CUSTOMER WEBSITE ROUTES
   SEPARATE FROM ADMIN
========================================================= */

const customerAuthRouter = require("./routes/customerAuth");

const customerOrdersRouter = require("./routes/customerOrders");

const publicProductsRouter = require("./routes/publicProducts");

const publicCategoriesRouter = require("./routes/publicCategories");


const app = express();

/* =========================================================
   CORS

   IMPORTANT:
   Admin + Customer website both allowed.

   credentials:true is required because customer login
   uses HttpOnly customer_token cookie.
========================================================= */

const allowedOrigins = [
  env.frontendUrl,
  env.customerFrontendUrl,

  // Local customer/admin Vite
  "http://localhost:5173",
  "http://127.0.0.1:5173",

  "http://localhost:5174",
  "http://127.0.0.1:5174",

  "http://localhost:5175",
  "http://127.0.0.1:5175",
].filter(Boolean);


app.use(
  cors({
    origin(origin, callback) {
      /*
       * No Origin:
       * Postman / server-to-server / same-origin.
       */
      if (!origin) {
        return callback(null, true);
      }

      /*
       * Configured frontend URLs.
       */
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      /*
       * Allow localhost during development.
       */
      if (
        origin.startsWith("http://localhost:") ||
        origin.startsWith("http://127.0.0.1:")
      ) {
        return callback(null, true);
      }

      console.warn(
        `[CORS] Blocked origin: ${origin}`
      );

      return callback(null, false);
    },

    credentials: true,

    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],

    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Accept",
    ],
  })
);


/* =========================================================
   BODY PARSERS
========================================================= */

app.use(
  express.json({
    limit: "2mb",
  })
);

app.use(
  express.urlencoded({
    extended: true,
  })
);


/* =========================================================
   UPLOADS
========================================================= */

const uploadDir = ensureUploadDir();

app.use(
  "/uploads",
  express.static(uploadDir)
);


/* =========================================================
   HEALTH CHECK
========================================================= */

app.get(
  "/api/health",
  async (req, res) => {
    try {
      const [[row]] =
        await pool.query(
          `
            SELECT
              DATABASE() AS db,
              COUNT(*) AS users
            FROM ??
          `,
          [`${P}users`]
        );

      res.json({
        status: "ok",
        db: "connected",
        database: row.db,
        prefix: P,
        users: row.users,
        timestamp:
          new Date().toISOString(),
      });
    } catch (err) {
      console.error(
        "[HEALTH ERROR]",
        err
      );

      res.status(500).json({
        status: "error",
        message: err.message,
      });
    }
  }
);


/* =========================================================
   CUSTOMER AUTH

   Separate from admin auth.

   Existing admin:
       /api/auth

   Customer:
       /api/auth/customer
========================================================= */

app.use(
  "/api/auth/customer",
  customerAuthRouter
);

app.use(
  "/api/customer",
  customerOrdersRouter
);


/* =========================================================
   PUBLIC CUSTOMER PRODUCT APIs

   IMPORTANT:
   These routes MUST come BEFORE existing admin product route.

   Customer frontend:
       /api/products/public
       /api/products/public/:id

   This avoids touching the existing admin:
       /api/products
========================================================= */

app.use(
  "/api/products/public",
  publicProductsRouter
);


/* =========================================================
   PUBLIC CUSTOMER CATEGORY APIs

   Customer frontend:
       /api/categories/public
       /api/categories/public/:id
========================================================= */

app.use(
  "/api/categories/public",
  publicCategoriesRouter
);


/* =========================================================
   EXISTING ADMIN AUTH

   DO NOT CHANGE
========================================================= */

app.use(
  "/api/auth",
  authRouter
);


/* =========================================================
   EXISTING ADMIN ROUTES

   IMPORTANT:
   These paths are kept EXACTLY like your original working
   app.js so the admin panel does not break.
========================================================= */

app.use(
  "/api/dashboard",
  dashboardRouter
);

app.use(
  "/api/products",
  productsRouter
);

app.use(
  "/api/categories",
  categoriesRouter
);

app.use(
  "/api/orders",
  ordersRouter
);

app.use(
  "/api/customers",
  customersRouter
);

app.use(
  "/api/payments",
  paymentsRouter
);

app.use(
  "/api/coupons",
  couponsRouter
);

app.use(
  "/api/shipping",
  shippingRouter
);

app.use(
  "/api/users",
  usersRouter
);

app.use(
  "/api/media",
  mediaRouter
);

app.use(
  "/api/reports",
  reportsRouter
);

app.use(
  "/api/inventory",
  inventoryRouter
);

app.use(
  "/api/gst",
  gstRouter
);

app.use(
  "/api/settings",
  settingsRouter
);


/* =========================================================
   API 404

   Keep this AFTER all API routes.
========================================================= */

app.use(
  "/api",
  (req, res, next) => {
    /*
     * If no API route above matched,
     * return a clean JSON 404.
     */
    return res.status(404).json({
      error: "API route not found",
      method: req.method,
      path: req.originalUrl,
    });
  }
);


/* =========================================================
   GLOBAL ERROR HANDLER

   MUST ALWAYS BE LAST.
========================================================= */

app.use(errorHandler);


module.exports = app;




// const path = require("path");
// const express = require("express");
// const cors = require("cors");

// const env = require("./config/env");
// const pool = require("./config/db");
// const P = require("./config/prefix");

// const errorHandler = require("./middleware/errorHandler");
// const {
//   ensureUploadDir,
// } = require("./services/mediaService");

// /* =========================================================
//    EXISTING ADMIN / BACKEND ROUTES
//    DO NOT CHANGE THESE ROUTE FILES
// ========================================================= */

// const authRouter = require("./routes/auth");
// const dashboardRouter = require("./routes/dashboard");

// const productsRouter = require("./routes/products");
// const categoriesRouter = require("./routes/categories");

// const ordersRouter = require("./routes/orders");
// const customersRouter = require("./routes/customers");
// const paymentsRouter = require("./routes/payments");
// const couponsRouter = require("./routes/coupons");
// const shippingRouter = require("./routes/shipping");
// const usersRouter = require("./routes/users");
// const mediaRouter = require("./routes/media");
// const reportsRouter = require("./routes/reports");
// const settingsRouter = require("./routes/settings");

// /* =========================================================
//    CUSTOMER WEBSITE ROUTES
//    SEPARATE FROM ADMIN
// ========================================================= */

// const customerAuthRouter = require("./routes/customerAuth");

// const customerOrdersRouter = require("./routes/customerOrders");

// const publicProductsRouter = require("./routes/publicProducts");

// const publicCategoriesRouter = require("./routes/publicCategories");


// const app = express();

// /* =========================================================
//    CORS

//    IMPORTANT:
//    Admin + Customer website both allowed.

//    credentials:true is required because customer login
//    uses HttpOnly customer_token cookie.
// ========================================================= */

// const allowedOrigins = [
//   env.frontendUrl,
//   env.customerFrontendUrl,

//   // Local customer/admin Vite
//   "http://localhost:5173",
//   "http://127.0.0.1:5173",

//   "http://localhost:5174",
//   "http://127.0.0.1:5174",

//   "http://localhost:5175",
//   "http://127.0.0.1:5175",
// ].filter(Boolean);


// app.use(
//   cors({
//     origin(origin, callback) {
//       /*
//        * No Origin:
//        * Postman / server-to-server / same-origin.
//        */
//       if (!origin) {
//         return callback(null, true);
//       }

//       /*
//        * Configured frontend URLs.
//        */
//       if (allowedOrigins.includes(origin)) {
//         return callback(null, true);
//       }

//       /*
//        * Allow localhost during development.
//        */
//       if (
//         origin.startsWith("http://localhost:") ||
//         origin.startsWith("http://127.0.0.1:")
//       ) {
//         return callback(null, true);
//       }

//       console.warn(
//         `[CORS] Blocked origin: ${origin}`
//       );

//       return callback(null, false);
//     },

//     credentials: true,

//     methods: [
//       "GET",
//       "POST",
//       "PUT",
//       "PATCH",
//       "DELETE",
//       "OPTIONS",
//     ],

//     allowedHeaders: [
//       "Content-Type",
//       "Authorization",
//       "Accept",
//     ],
//   })
// );


// /* =========================================================
//    BODY PARSERS
// ========================================================= */

// app.use(
//   express.json({
//     limit: "2mb",
//   })
// );

// app.use(
//   express.urlencoded({
//     extended: true,
//   })
// );


// /* =========================================================
//    UPLOADS
// ========================================================= */

// const uploadDir = ensureUploadDir();

// app.use(
//   "/uploads",
//   express.static(uploadDir)
// );


// /* =========================================================
//    HEALTH CHECK
// ========================================================= */

// app.get(
//   "/api/health",
//   async (req, res) => {
//     try {
//       const [[row]] =
//         await pool.query(
//           `
//             SELECT
//               DATABASE() AS db,
//               COUNT(*) AS users
//             FROM ??
//           `,
//           [`${P}users`]
//         );

//       res.json({
//         status: "ok",
//         db: "connected",
//         database: row.db,
//         prefix: P,
//         users: row.users,
//         timestamp:
//           new Date().toISOString(),
//       });
//     } catch (err) {
//       console.error(
//         "[HEALTH ERROR]",
//         err
//       );

//       res.status(500).json({
//         status: "error",
//         message: err.message,
//       });
//     }
//   }
// );


// /* =========================================================
//    CUSTOMER AUTH

//    Separate from admin auth.

//    Existing admin:
//        /api/auth

//    Customer:
//        /api/auth/customer
// ========================================================= */

// app.use(
//   "/api/auth/customer",
//   customerAuthRouter
// );

// app.use(
//   "/api/customer",
//   customerOrdersRouter
// );


// /* =========================================================
//    PUBLIC CUSTOMER PRODUCT APIs

//    IMPORTANT:
//    These routes MUST come BEFORE existing admin product route.

//    Customer frontend:
//        /api/products/public
//        /api/products/public/:id

//    This avoids touching the existing admin:
//        /api/products
// ========================================================= */

// app.use(
//   "/api/products/public",
//   publicProductsRouter
// );


// /* =========================================================
//    PUBLIC CUSTOMER CATEGORY APIs

//    Customer frontend:
//        /api/categories/public
//        /api/categories/public/:id
// ========================================================= */

// app.use(
//   "/api/categories/public",
//   publicCategoriesRouter
// );


// /* =========================================================
//    EXISTING ADMIN AUTH

//    DO NOT CHANGE
// ========================================================= */

// app.use(
//   "/api/auth",
//   authRouter
// );


// /* =========================================================
//    EXISTING ADMIN ROUTES

//    IMPORTANT:
//    These paths are kept EXACTLY like your original working
//    app.js so the admin panel does not break.
// ========================================================= */

// app.use(
//   "/api/dashboard",
//   dashboardRouter
// );

// app.use(
//   "/api/products",
//   productsRouter
// );

// app.use(
//   "/api/categories",
//   categoriesRouter
// );

// app.use(
//   "/api/orders",
//   ordersRouter
// );

// app.use(
//   "/api/customers",
//   customersRouter
// );

// app.use(
//   "/api/payments",
//   paymentsRouter
// );

// app.use(
//   "/api/coupons",
//   couponsRouter
// );

// app.use(
//   "/api/shipping",
//   shippingRouter
// );

// app.use(
//   "/api/users",
//   usersRouter
// );

// app.use(
//   "/api/media",
//   mediaRouter
// );

// app.use(
//   "/api/reports",
//   reportsRouter
// );

// app.use(
//   "/api/settings",
//   settingsRouter
// );


// /* =========================================================
//    API 404

//    Keep this AFTER all API routes.
// ========================================================= */

// app.use(
//   "/api",
//   (req, res, next) => {
//     /*
//      * If no API route above matched,
//      * return a clean JSON 404.
//      */
//     return res.status(404).json({
//       error: "API route not found",
//       method: req.method,
//       path: req.originalUrl,
//     });
//   }
// );


// /* =========================================================
//    GLOBAL ERROR HANDLER

//    MUST ALWAYS BE LAST.
// ========================================================= */

// app.use(errorHandler);


// module.exports = app;


