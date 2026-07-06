import {useState} from 'react'
import {
  type AppBskyActorDefs,
  type AppBskyActorProfile,
  type AppBskyGraphDefs,
  AppBskyGraphStarterpack,
  type Un$Typed,
} from '@atproto/api'
import {TID} from '@atproto/common-web'
import {useQueryClient} from '@tanstack/react-query'

import {uploadBlob} from '#/lib/api'
import {DISCOVER_SAVED_FEED, TIMELINE_SAVED_FEED} from '#/lib/constants'
import {logger} from '#/logger'
import {useSetHasCheckedForStarterPack} from '#/state/preferences/used-starter-packs'
import {getAllListMembers} from '#/state/queries/list-members'
import {preferencesQueryKey} from '#/state/queries/preferences'
import {RQKEY as profileRQKey} from '#/state/queries/profile'
import {useAgent} from '#/state/session'
import {useOnboardingDispatch} from '#/state/shell'
import {
  useActiveStarterPack,
  useSetActiveStarterPack,
} from '#/state/shell/landing'
import {useProgressGuideControls} from '#/state/shell/progress-guide'
import {
  type OnboardingState,
  useOnboardingInternalState,
} from '#/screens/Onboarding/state'
import {bulkWriteFollows} from '#/screens/Onboarding/util'
import {useAnalytics} from '#/analytics'
import * as bsky from '#/types/bsky'

/**
 * Runs the side effects that complete onboarding: uploads the avatar and
 * saves it to the profile, applies starter-pack follows and feeds when the
 * user signed up via a starter pack, and marks onboarding finished.
 *
 * Extracted from the old StepFinished screen, which no longer renders. Note
 * that the brand-account follow and default feed seeding happen at account
 * creation (see createAgentAndCreateAccount), not here.
 *
 * `finishOnboarding` takes the profile step results as an argument rather
 * than reading them from context, because the caller dispatches them in the
 * same tick.
 */
export function useFinishOnboarding() {
  const ax = useAnalytics()
  const {dispatch} = useOnboardingInternalState()
  const onboardDispatch = useOnboardingDispatch()
  const [saving, setSaving] = useState(false)
  const queryClient = useQueryClient()
  const agent = useAgent()
  const activeStarterPack = useActiveStarterPack()
  const setActiveStarterPack = useSetActiveStarterPack()
  const setHasCheckedForStarterPack = useSetHasCheckedForStarterPack()
  const {startProgressGuide} = useProgressGuideControls()

  const finishOnboarding = async (
    profileStepResults: OnboardingState['profileStepResults'],
  ) => {
    setSaving(true)

    let starterPack: AppBskyGraphDefs.StarterPackView | undefined
    let listItems: AppBskyGraphDefs.ListItemView[] | undefined

    if (activeStarterPack?.uri) {
      try {
        const spRes = await agent.app.bsky.graph.getStarterPack({
          starterPack: activeStarterPack.uri,
        })
        starterPack = spRes.data.starterPack
      } catch (e) {
        logger.error('Failed to fetch starter pack', {safeMessage: e})
        // don't tell the user, just get them through onboarding.
      }
      try {
        if (starterPack?.list) {
          listItems = await getAllListMembers(agent, starterPack.list.uri)
        }
      } catch (e) {
        logger.error('Failed to fetch starter pack list items', {
          safeMessage: e,
        })
        // don't tell the user, just get them through onboarding.
      }
    }

    try {
      await Promise.all([
        (async () => {
          /*
           * The brand account is already followed at account creation, so
           * follows here are only needed for starter-pack members.
           */
          if (starterPack && listItems?.length) {
            await bulkWriteFollows(
              agent,
              listItems.map(i => i.subject.did),
              {uri: starterPack.uri, cid: starterPack.cid},
            )
          }
        })(),
        (async () => {
          /*
           * Authoritatively pin the brand default feeds (brand feed +
           * following), plus any starter-pack feeds. Feeds are also seeded at
           * account creation, but that can be lost: if no savedFeedsPrefV2
           * exists yet, the first getPreferences() synthesizes and persists a
           * following-only default, permanently dropping the brand feed. This
           * runs late (after the session is live) and unconditionally, so it
           * reliably restores the brand feed regardless of that race.
           */
          const feedsToSave: AppBskyActorDefs.SavedFeed[] = [
            {
              ...DISCOVER_SAVED_FEED,
              id: TID.nextStr(),
            },
            {
              ...TIMELINE_SAVED_FEED,
              id: TID.nextStr(),
            },
            ...(starterPack?.feeds?.length
              ? starterPack.feeds.map(f => ({
                  type: 'feed',
                  value: f.uri,
                  pinned: true,
                  id: TID.nextStr(),
                }))
              : []),
          ]
          await agent.overwriteSavedFeeds(feedsToSave)
        })(),
        (async () => {
          const {imageUri, imageMime} = profileStepResults
          const blobPromise =
            imageUri && imageMime
              ? uploadBlob(agent, imageUri, imageMime)
              : undefined

          await agent.upsertProfile(async existing => {
            /*
             * displayName is deliberately not touched here - it is set at
             * account creation from the name entered during signup.
             */
            const next: Un$Typed<AppBskyActorProfile.Record> = existing ?? {}

            if (blobPromise) {
              const res = await blobPromise
              if (res.data.blob) {
                next.avatar = res.data.blob
              }
            }

            if (starterPack) {
              next.joinedViaStarterPack = {
                uri: starterPack.uri,
                cid: starterPack.cid,
              }
            }

            if (!next.createdAt) {
              next.createdAt = new Date().toISOString()
            }
            return next
          })

          ax.metric('onboarding:finished:avatarResult', {
            avatarResult: profileStepResults.isCreatedAvatar
              ? 'created'
              : profileStepResults.image
                ? 'uploaded'
                : 'default',
          })
        })(),
      ])
    } catch (e) {
      logger.info(`onboarding: bulk save failed`)
      logger.error(e instanceof Error ? e : String(e))
      // don't alert the user, just let them into their account
    }

    // Try to ensure that prefs and profile are up-to-date by the time we render Home.
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      }),
      queryClient.invalidateQueries({
        queryKey: profileRQKey(agent.session?.did ?? ''),
      }),
    ]).catch(e => {
      logger.error(e)
      // Keep going.
    })

    setSaving(false)
    setActiveStarterPack(undefined)
    setHasCheckedForStarterPack(true)
    startProgressGuide('follow-10')
    dispatch({type: 'finish'})
    onboardDispatch({type: 'finish'})
    ax.metric('onboarding:finished:nextPressed', {
      usedStarterPack: Boolean(starterPack),
      starterPackName:
        starterPack &&
        bsky.dangerousIsType<AppBskyGraphStarterpack.Record>(
          starterPack.record,
          AppBskyGraphStarterpack.isRecord,
        )
          ? starterPack.record.name
          : undefined,
      starterPackCreator: starterPack?.creator.did,
      starterPackUri: starterPack?.uri,
      profilesFollowed: listItems?.length ?? 0,
      feedsPinned: starterPack?.feeds?.length ?? 0,
    })
    if (starterPack && listItems?.length) {
      ax.metric('starterPack:followAll', {
        logContext: 'Onboarding',
        starterPack: starterPack.uri,
        count: listItems?.length,
      })
    }
  }

  return {finishOnboarding, saving}
}
