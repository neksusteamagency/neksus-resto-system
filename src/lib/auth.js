// Phase 1 staff access: a PIN per role, remembered for the browser session only.
// This keeps casual customers out of the kitchen and admin screens, but it is NOT real
// security: phase 2 replaces it with Firebase Authentication and Firestore rules.
const KEY = "neksus-dine:role";

export const getRole = () => {
  try { return sessionStorage.getItem(KEY); } catch { return null; }
};
export const setRole = (role) => {
  try { role ? sessionStorage.setItem(KEY, role) : sessionStorage.removeItem(KEY); } catch { /* ignore */ }
};
export const canAccess = (needed, role) => role === "admin" || (needed === "kitchen" && role === "kitchen");
