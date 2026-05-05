import {GOOGLE_WEB_CLIENT_ID} from '#/env'

export function useGoogleIdToken() {
  const getIdToken = (): Promise<string> =>
    new Promise((resolve, reject) => {
      const google = (window as any).google
      if (!google?.accounts?.id) {
        return reject(new Error('Google Identity Services not loaded'))
      }
      if (!GOOGLE_WEB_CLIENT_ID) {
        return reject(new Error('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not set'))
      }
      google.accounts.id.initialize({
        client_id: GOOGLE_WEB_CLIENT_ID,
        callback: (r: {credential: string}) => resolve(r.credential),
        auto_select: false,
      })
      const el = document.createElement('div')
      el.style.position = 'fixed'
      el.style.top = '-9999px'
      document.body.appendChild(el)
      google.accounts.id.renderButton(el, {type: 'standard', size: 'large'})
      const btn = el.querySelector('div[role="button"]') as HTMLElement
      if (btn) btn.click()
      else {
        google.accounts.id.prompt((n: any) => {
          if (n.isNotDisplayed() || n.isSkippedMoment())
            reject(new Error('Google sign-in dismissed'))
        })
      }
      setTimeout(() => el.parentNode?.removeChild(el), 60000)
    })

  return {getIdToken}
}
