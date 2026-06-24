export function shouldUploadLocalCache(localExpenses, remoteExpenses) {
  if (!Array.isArray(localExpenses) || localExpenses.length === 0) return false;
  if (!Array.isArray(remoteExpenses) || remoteExpenses.length === 0) return true;
  return false;
}
