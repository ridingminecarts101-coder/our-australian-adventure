/* Supabase connection settings.
 *
 * These three values are PUBLIC — they ship inside the app and anyone can read
 * them. That is fine and expected: the anon key grants nothing on its own,
 * because Row Level Security requires a signed-in session (see
 * supabase/schema.sql). What must NEVER go in this file is the service_role
 * key from the Supabase dashboard — that one bypasses every security rule.
 */
window.OAA_CONFIG = {
  // Supabase → Project Settings → Data API → Project URL
  supabaseUrl: 'https://ajyuozqoukigeeyhvuqc.supabase.co',

  // Supabase → Project Settings → API Keys → anon / publishable key
  supabaseAnonKey: 'YOUR_SUPABASE_ANON_KEY',

  // The single shared account both phones sign in as. The passphrase typed on
  // the lock screen is this account's password.
  sharedEmail: 'YOUR_SHARED_EMAIL',
};
