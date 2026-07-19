import {type JSX} from 'react'
import {View} from 'react-native'

// Temporarily hidden with the feeds shortcut below.
// import {msg} from '@lingui/core/macro'
// import {useLingui} from '@lingui/react'
import {useKawaiiMode} from '#/state/preferences/kawaii'
import {useSession} from '#/state/session'
import {useShellLayout} from '#/state/shell/shell-layout'
import {HomeHeaderLayoutMobile} from '#/view/com/home/HomeHeaderLayoutMobile'
import {Logo} from '#/view/icons/Logo'
import {Logotype} from '#/view/icons/Logotype'
import {atoms as a, useBreakpoints, useGutters, useTheme} from '#/alf'
// Temporarily hidden with the feeds shortcut below.
// import {HITSLOP_10} from '#/lib/constants'
// import {ButtonIcon} from '#/components/Button'
// import {Hashtag_Stroke2_Corner0_Rounded as FeedsIcon} from '#/components/icons/Hashtag'
// import {Link} from '#/components/Link'
// import {useAnalytics} from '#/analytics'
import * as Layout from '#/components/Layout'
import {getActiveBrand} from '#/brand/activeBrand'

export function HomeHeaderLayout(props: {
  children: React.ReactNode
  tabBarAnchor: JSX.Element | null | undefined
}) {
  const {gtMobile} = useBreakpoints()
  if (!gtMobile) {
    return <HomeHeaderLayoutMobile {...props} />
  } else {
    return <HomeHeaderLayoutDesktopAndTablet {...props} />
  }
}

function HomeHeaderLayoutDesktopAndTablet({
  children,
  tabBarAnchor,
}: {
  children: React.ReactNode
  tabBarAnchor: JSX.Element | null | undefined
}) {
  const t = useTheme()
  const {headerHeight} = useShellLayout()
  const {hasSession} = useSession()
  // Temporarily hidden with the feeds shortcut below.
  // const {_} = useLingui()
  // const ax = useAnalytics()
  const kawaii = useKawaiiMode()
  const gutters = useGutters([0, 'base'])
  const brand = getActiveBrand()

  return (
    <>
      {hasSession && (
        <Layout.Center>
          <View
            style={[a.flex_row, a.align_center, gutters, a.pt_md, t.atoms.bg]}>
            {/*
             * This spacer balanced the feeds button on the right so the logo
             * stayed centered. Both are hidden together for now; restore them
             * together to keep the logo centered.
             */}
            {/* <View style={{width: 34}} /> */}
            <View style={[a.flex_1, a.align_center, a.justify_center]}>
              {kawaii ? (
                <Logo width={60} />
              ) : (
                <Logotype
                  width={brand.logo.logotypeHeaderWidth || 140}
                  fill={t.name === 'light' ? t.palette.primary_500 : '#ffffff'}
                />
              )}
            </View>
            {/* Temporarily hidden: unfinished Bluesky-derived feeds feature. */}
            {/* <Link
              to="/feeds"
              hitSlop={HITSLOP_10}
              label={_(msg`View your feeds and explore more`)}
              size="small"
              variant="ghost"
              color="secondary"
              shape="square"
              onPress={() => {
                ax.metric('nav:click', {item: 'feeds', surface: 'topBar'})
              }}
              style={[a.justify_center]}>
              <ButtonIcon icon={FeedsIcon} size="lg" />
            </Link> */}
          </View>
        </Layout.Center>
      )}
      {tabBarAnchor}
      <Layout.Center
        style={[a.sticky, a.z_10, a.align_center, t.atoms.bg, {top: 0}]}
        onLayout={e => {
          headerHeight.set(e.nativeEvent.layout.height)
        }}>
        {children}
      </Layout.Center>
    </>
  )
}
