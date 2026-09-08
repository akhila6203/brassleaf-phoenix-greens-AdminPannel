const P = require('./prefix');

/** WordPress usermeta keys — must match table prefix (wpwd_). */
module.exports = {
  capabilities: `${P}capabilities`,
  userLevel: `${P}user_level`,
};
