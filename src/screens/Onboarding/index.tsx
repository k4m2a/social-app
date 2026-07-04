import {useMemo, useReducer} from 'react'
import {View} from 'react-native'

import {
  Layout,
  OnboardingControls,
  OnboardingHeaderSlot,
} from '#/screens/Onboarding/Layout'
import {
  Context,
  createInitialOnboardingState,
  reducer,
} from '#/screens/Onboarding/state'
import {StepProfile} from '#/screens/Onboarding/StepProfile'
import {atoms as a, useTheme} from '#/alf'
import {Portal} from '#/components/Portal'
import {ScreenTransition} from '#/components/ScreenTransition'

/*
 * Onboarding is a single step: the profile picture. The finishing side
 * effects (avatar upload etc.) run from StepProfile's continue button via
 * useFinishOnboarding. Display name and username are collected during
 * signup, and default feeds plus the brand-account follow are seeded at
 * account creation.
 */
export function Onboarding() {
  const t = useTheme()

  const [state, dispatch] = useReducer(
    reducer,
    undefined,
    createInitialOnboardingState,
  )

  return (
    <Portal>
      <View style={[a.absolute, a.inset_0, t.atoms.bg]}>
        <OnboardingControls.Provider>
          <OnboardingHeaderSlot.Provider>
            <Context.Provider
              value={useMemo(() => ({state, dispatch}), [state, dispatch])}>
              <ScreenTransition
                key={state.activeStep}
                direction={state.stepTransitionDirection}
                style={a.flex_1}>
                <Layout>
                  {state.activeStep === 'profile' && <StepProfile />}
                </Layout>
              </ScreenTransition>
            </Context.Provider>
          </OnboardingHeaderSlot.Provider>
        </OnboardingControls.Provider>
      </View>
    </Portal>
  )
}
