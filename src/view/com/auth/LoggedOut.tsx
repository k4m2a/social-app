import {useCallback, useEffect, useState} from 'react'
import {View} from 'react-native'
import {useSafeAreaInsets} from 'react-native-safe-area-context'
import {msg} from '@lingui/core/macro'
import {useLingui} from '@lingui/react'
import {useQueryClient} from '@tanstack/react-query'

import {DEFAULT_SERVICE} from '#/lib/constants'
import {PressableScale} from '#/lib/custom-animations/PressableScale'
import {logger} from '#/logger'
import {STALE} from '#/state/queries'
import {profilesQueryKey} from '#/state/queries/profile'
import {useAgent, useSession, useSessionApi} from '#/state/session'
import {
  useLoggedOutView,
  useLoggedOutViewControls,
} from '#/state/shell/logged-out'
import {useEnableMinimalShellMode} from '#/state/shell/minimal-mode'
import {ErrorBoundary} from '#/view/com/util/ErrorBoundary'
import {Login} from '#/screens/Login'
import {Signup} from '#/screens/Signup'
import {LandingScreen} from '#/screens/StarterPack/StarterPackLandingScreen'
import {atoms as a, native, tokens, useTheme} from '#/alf'
import {Button, ButtonIcon} from '#/components/Button'
import {TimesLarge_Stroke2_Corner0_Rounded as XIcon} from '#/components/icons/Times'
import {useAnalytics} from '#/analytics'
import {useGoogleIdToken} from '#/features/googleAuth/useGoogleIdToken'
import {SplashScreen} from './SplashScreen'

enum ScreenState {
  S_LoginOrCreateAccount,
  S_Login,
  S_CreateAccount,
  S_StarterPack,
}
export {ScreenState as LoggedOutScreenState}

export function LoggedOut({onDismiss}: {onDismiss?: () => void}) {
  const {_} = useLingui()
  const ax = useAnalytics()
  const t = useTheme()
  const insets = useSafeAreaInsets()
  useEnableMinimalShellMode()
  const {requestedAccountSwitchTo} = useLoggedOutView()
  const [screenState, setScreenState] = useState<ScreenState>(() => {
    if (requestedAccountSwitchTo === 'new') {
      return ScreenState.S_CreateAccount
    } else if (requestedAccountSwitchTo === 'starterpack') {
      return ScreenState.S_StarterPack
    } else if (requestedAccountSwitchTo != null) {
      return ScreenState.S_Login
    } else {
      return ScreenState.S_LoginOrCreateAccount
    }
  })
  const {clearRequestedAccount, setShowLoggedOut} = useLoggedOutViewControls()
  const [googleEmail, setGoogleEmail] = useState<string | undefined>()
  const {googleLogin} = useSessionApi()
  const {getIdToken} = useGoogleIdToken()

  const queryClient = useQueryClient()
  const {accounts} = useSession()
  const agent = useAgent()
  useEffect(() => {
    const actors = accounts.map(acc => acc.did)
    if (actors.length === 0) return
    void queryClient.prefetchQuery({
      queryKey: profilesQueryKey(actors),
      staleTime: STALE.MINUTES.FIVE,
      queryFn: async () => {
        const res = await agent.getProfiles({actors})
        return res.data
      },
    })
  }, [accounts, agent, queryClient])

  const onPressDismiss = useCallback(() => {
    if (onDismiss) {
      onDismiss()
    }
    clearRequestedAccount()
  }, [clearRequestedAccount, onDismiss])

  const handleGoogleSignIn = async () => {
    try {
      const idToken = await getIdToken()
      const res = await fetch(
        `${DEFAULT_SERVICE}/api/google-auth`,
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({idToken, action: 'sign-in'}),
        },
      )
      if (!res.ok) throw new Error('Google auth failed')
      const data = await res.json()
      if (!data.success || data.action === 'needs-signup') {
        setGoogleEmail(data.email)
        setScreenState(ScreenState.S_CreateAccount)
        return
      }
      // Account found — if PDS returns session tokens, log in
      if (data.accessJwt && data.refreshJwt) {
        await googleLogin(
          {
            service: DEFAULT_SERVICE,
            accessJwt: data.accessJwt,
            refreshJwt: data.refreshJwt,
            did: data.did,
            handle: data.handle,
            email: data.email,
            emailConfirmed: data.emailConfirmed ?? true,
            active: data.active ?? true,
            status: data.status,
          },
          'GoogleSignIn',
        )
        setShowLoggedOut(false)
      } else {
        throw new Error('Server did not return session tokens. Please rebuild your PDS.')
      }
    } catch (e: any) {
      logger.warn('Google sign-in failed', {error: e.toString()})
    }
  }

  return (
    <View
      testID="noSessionView"
      style={[
        a.util_screen_outer,
        t.atoms.bg,
        {paddingTop: insets.top, paddingBottom: insets.bottom},
      ]}>
      <ErrorBoundary>
        {onDismiss && screenState === ScreenState.S_LoginOrCreateAccount ? (
          <Button
            label={_(msg`Go back`)}
            variant="solid"
            color="secondary_inverted"
            size="small"
            shape="round"
            PressableComponent={native(PressableScale)}
            style={[
              a.absolute,
              {
                top: insets.top + tokens.space.xl,
                right: tokens.space.xl,
                zIndex: 100,
              },
            ]}
            onPress={onPressDismiss}>
            <ButtonIcon icon={XIcon} />
          </Button>
        ) : null}

        {screenState === ScreenState.S_StarterPack ? (
          <LandingScreen setScreenState={setScreenState} />
        ) : screenState === ScreenState.S_LoginOrCreateAccount ? (
          <SplashScreen
            onPressSignin={() => {
              setScreenState(ScreenState.S_Login)
              ax.metric('splash:signInPressed', {})
            }}
            onPressCreateAccount={() => {
              setScreenState(ScreenState.S_CreateAccount)
              ax.metric('splash:createAccountPressed', {})
            }}
            onPressGoogleSignIn={handleGoogleSignIn}
          />
        ) : undefined}
        {screenState === ScreenState.S_Login ? (
          <Login
            onPressBack={() => {
              setScreenState(ScreenState.S_LoginOrCreateAccount)
              clearRequestedAccount()
            }}
            onAccountNotFound={email => {
              setGoogleEmail(email)
              setScreenState(ScreenState.S_CreateAccount)
            }}
          />
        ) : undefined}
        {screenState === ScreenState.S_CreateAccount ? (
          <Signup
            onPressBack={() => {
              setGoogleEmail(undefined)
              setScreenState(ScreenState.S_LoginOrCreateAccount)
            }}
            prefillEmail={googleEmail}
          />
        ) : undefined}
      </ErrorBoundary>
    </View>
  )
}
