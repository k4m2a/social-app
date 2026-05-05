import {useState} from 'react'
import {View} from 'react-native'
import {Trans, useLingui} from '@lingui/react/macro'

import {DEFAULT_SERVICE} from '#/lib/constants'
import {logger} from '#/logger'
import {useSessionApi} from '#/state/session'
import {useLoggedOutViewControls} from '#/state/shell/logged-out'
import {atoms as a, useTheme} from '#/alf'
import {Button, ButtonIcon, ButtonText} from '#/components/Button'
import * as Dialog from '#/components/Dialog'
import {Divider} from '#/components/Divider'
import {Loader} from '#/components/Loader'
import {Text} from '#/components/Typography'
import {useGoogleIdToken} from '#/features/googleAuth/useGoogleIdToken'

type GoogleAuthPdsResponse =
  | {success: true; action: 'sign-in' | 'linked'; did: string; handle: string; email: string; accessJwt?: string; refreshJwt?: string; emailConfirmed?: boolean; active?: boolean; status?: string}
  | {success: false; action: 'needs-signup'; email: string; name?: string; googleId: string}

export function GoogleSignInButton({
  serviceUrl = DEFAULT_SERVICE,
  onAccountNotFound,
  onError,
  skipConfirmDialog,
}: {
  serviceUrl?: string
  onAccountNotFound?: (email: string, idToken?: string) => void
  onError?: (error: string) => void
  skipConfirmDialog?: boolean
}) {
  const {t: l} = useLingui()
  const t = useTheme()
  const {googleLogin} = useSessionApi()
  const {setShowLoggedOut} = useLoggedOutViewControls()
  const {getIdToken} = useGoogleIdToken()
  const [isProcessing, setIsProcessing] = useState(false)
  const confirmCtl = Dialog.useDialogControl()
  const [pendingEmail, setPendingEmail] = useState('')

  const handlePress = async () => {
    if (isProcessing) return
    setIsProcessing(true)
    try {
      const idToken = await getIdToken()
      const res = await fetch(
        `${serviceUrl}/api/google-auth`,
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({idToken, action: 'sign-in'}),
        },
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Google auth failed')
      }
      const data: GoogleAuthPdsResponse = await res.json()

      if (!data.success) {
        // No account — on signup screen just pre-fill, otherwise show dialog
        if (skipConfirmDialog) {
          onAccountNotFound?.(data.email, idToken)
        } else {
          setPendingEmail(data.email)
          confirmCtl.open()
        }
        return
      }

      // Account found (sign-in or linked) — if PDS returns tokens, use them
      if (data.accessJwt && data.refreshJwt) {
        await googleLogin(
          {
            service: serviceUrl,
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
      onError?.(e.toString())
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <>
      <View style={[a.gap_md, a.pt_md]}>
        <Divider />
        <Text style={[a.text_sm, a.text_center, t.atoms.text_contrast_medium]}>
          <Trans>or</Trans>
        </Text>
        <Button
          testID="googleSignInButton"
          label={l`Sign in with Google`}
          color="secondary"
          size="large"
          onPress={handlePress}
          disabled={isProcessing}>
          {isProcessing && <ButtonIcon icon={Loader} />}
          <ButtonText><Trans>Continue with Google</Trans></ButtonText>
        </Button>
      </View>

      <Dialog.Outer control={confirmCtl}>
        <Dialog.Handle />
        <Dialog.ScrollableInner label={l`Account not found`}>
          <Dialog.Header>
            <Dialog.HeaderText><Trans>Account not found</Trans></Dialog.HeaderText>
          </Dialog.Header>
          <Text style={[a.text_md, a.pb_lg, t.atoms.text]}>
            <Trans>No account exists for {pendingEmail}. Would you like to create one?</Trans>
          </Text>
          <View style={[a.flex_row, a.gap_md, a.justify_end]}>
            <Button label={l`Cancel`} color="secondary" size="large" onPress={() => confirmCtl.close()}>
              <ButtonText><Trans>Cancel</Trans></ButtonText>
            </Button>
            <Button testID="googleCreateAccountBtn" label={l`Create account`} color="primary" size="large"
              onPress={() => confirmCtl.close(() => onAccountNotFound?.(pendingEmail))}>
              <ButtonText><Trans>Create account</Trans></ButtonText>
            </Button>
          </View>
          <Dialog.Close />
        </Dialog.ScrollableInner>
      </Dialog.Outer>
    </>
  )
}
