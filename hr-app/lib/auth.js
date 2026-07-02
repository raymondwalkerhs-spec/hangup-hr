const { useSupabase } = require("./backend");

module.exports = useSupabase() ? require("./auth-supabase") : require("./auth-sheet");
