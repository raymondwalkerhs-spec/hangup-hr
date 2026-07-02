/**
 * Express middleware attaching Supabase clients from lib/supabase-client.
 */
const {
  getSupabaseAdmin,
  getSupabaseAnon,
  hasSupabaseAdminKey,
} = require("./supabase-client");

function withSupabase(config = { auth: "secret" }) {
  const { auth = "secret" } = config;

  return function supabaseMiddleware(req, res, next) {
    try {
      if (auth === "secret") {
        if (!hasSupabaseAdminKey()) {
          return res.status(401).json({
            error: "SUPABASE_SECRET_KEY is not configured",
            code: "missing_secret_key",
          });
        }
        req.supabaseAdmin = getSupabaseAdmin();
        req.supabase = req.supabaseAdmin;
        req.supabaseContext = { authMode: "secret" };
      } else {
        req.supabase = getSupabaseAnon();
        req.supabaseContext = { authMode: "publishable" };
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = {
  withSupabase,
};
