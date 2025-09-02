export function generateUniqueId(): string {
  const base = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let extra = "";
  for (let i = 0; i < 4; i++) {
    extra += letters.charAt(Math.floor(Math.random() * letters.length));
  }
  return base + extra;
}