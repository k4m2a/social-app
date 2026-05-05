export function useGoogleIdToken() {
  return {
    // i have just done google auth for web 
    getIdToken: (): Promise<string> =>
      Promise.reject(new Error('Google Sign-In not yet supported on native')),
  }
}
