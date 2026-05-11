import {
  isConnected,
  getAddress,
  signTransaction,
  requestAccess,
} from "@stellar/freighter-api";

export async function connectFreighter(): Promise<void> {
  const result = await isConnected();
  if (!result.isConnected) throw new Error("Freighter extension not found. Please install it.");
  await requestAccess();
}

export async function getFreighterAddress(): Promise<string> {
  const result = await getAddress();
  if (result.error || !result.address) {
    throw new Error(result.error?.message || "Could not get address from Freighter");
  }
  return result.address;
}

export async function signXdr(xdr: string, networkPassphrase: string): Promise<string> {
  console.log('[Freighter] Requesting signature for XDR:', xdr.substring(0, 50) + '...');
  const result = await signTransaction(xdr, { networkPassphrase });
  console.log('[Freighter] Sign result:', { 
    hasError: !!result.error, 
    hasSignedTxXdr: !!result.signedTxXdr,
    errorMessage: result.error?.message 
  });
  if (result.error || !result.signedTxXdr) {
    throw new Error(result.error?.message || "User rejected signing or Freighter error");
  }
  return result.signedTxXdr;
}