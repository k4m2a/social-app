import {
  Agent as BaseAgent,
  type AppBskyActorProfile,
  AtpAgent,
  type AtprotoServiceType,
  type AtpSessionData,
  type AtpSessionEvent,
  type Did,
  type Un$Typed,
} from '@atproto/api'
import {TID} from '@atproto/common-web'

import {networkRetry} from '#/lib/async/retry'
import {
  BLUESKY_PROXY_HEADER,
  BSKY_SERVICE,
  IS_PROD_SERVICE,
  PUBLIC_BSKY_SERVICE,
} from '#/lib/constants'
import {logger} from '#/logger'
import {snoozeBirthdateUpdateAllowedForDid} from '#/state/birthdate'
import {restrictChatSettings} from '#/state/queries/messages/restrictChatSettings'
import {snoozeEmailConfirmationPrompt} from '#/state/shell/reminders'
import {
  prefetchAgeAssuranceServerData,
  setBirthdateForDid,
  setCreatedAtForDid,
} from '#/ageAssurance/data'
import {unsafeGetAndComputeAgeAssurance} from '#/ageAssurance/state'
import {features} from '#/analytics'
import {getActiveBrand} from '#/brand/activeBrand'
import {emitNetworkConfirmed, emitNetworkLost} from '../events'
import {addSessionErrorLog} from './logging'
import {
  configureModerationForAccount,
  configureModerationForGuest,
} from './moderation'
import {type SessionAccount} from './types'
import {isSessionExpired, isSignupQueued} from './util'

export type ProxyHeaderValue = `${Did}#${AtprotoServiceType}`

export function createPublicAgent() {
  configureModerationForGuest() // Side effect but only relevant for tests

  const agent = new BskyAppAgent({service: PUBLIC_BSKY_SERVICE})
  agent.configureProxy(BLUESKY_PROXY_HEADER.get())
  return agent
}

export async function createAgentAndResume(
  storedAccount: SessionAccount,
  onSessionChange: (
    agent: AtpAgent,
    did: string,
    event: AtpSessionEvent,
  ) => void,
) {
  const agent = new BskyAppAgent({service: storedAccount.service})
  if (storedAccount.pdsUrl) {
    agent.sessionManager.pdsUrl = new URL(storedAccount.pdsUrl)
  }
  const gates = features.refresh({
    strategy: 'prefer-low-latency',
  })
  const moderation = configureModerationForAccount(agent, storedAccount)
  const prevSession: AtpSessionData = sessionAccountToSession(storedAccount)
  if (isSessionExpired(storedAccount)) {
    await networkRetry(1, () => agent.resumeSession(prevSession))
  } else {
    agent.sessionManager.session = prevSession
  }

  // after session is attached
  const aa = prefetchAgeAssuranceServerData({agent})

  agent.configureProxy(BLUESKY_PROXY_HEADER.get())

  return agent.prepare({
    resolvers: [gates, moderation, aa],
    onSessionChange,
  })
}

export async function createAgentAndLogin(
  {
    service,
    identifier,
    password,
    authFactorToken,
  }: {
    service: string
    identifier: string
    password: string
    authFactorToken?: string
  },
  onSessionChange: (
    agent: AtpAgent,
    did: string,
    event: AtpSessionEvent,
  ) => void,
) {
  const agent = new BskyAppAgent({service})
  await agent.login({
    identifier,
    password,
    authFactorToken,
    allowTakendown: true,
  })

  const account = agentToSessionAccountOrThrow(agent)
  const gates = features.refresh({strategy: 'prefer-fresh-gates'})
  const moderation = configureModerationForAccount(agent, account)
  const aa = prefetchAgeAssuranceServerData({agent})

  agent.configureProxy(BLUESKY_PROXY_HEADER.get())

  return agent.prepare({
    resolvers: [gates, moderation, aa],
    onSessionChange,
  })
}

export async function createAgentAndCreateAccount(
  {
    service,
    email,
    password,
    handle,
    birthDate,
    inviteCode,
    verificationPhone,
    verificationCode,
  }: {
    service: string
    email: string
    password: string
    handle: string
    birthDate: Date
    inviteCode?: string
    verificationPhone?: string
    verificationCode?: string
  },
  onSessionChange: (
    agent: AtpAgent,
    did: string,
    event: AtpSessionEvent,
  ) => void,
) {
  const agent = new BskyAppAgent({service})
  await agent.createAccount({
    email,
    password,
    handle,
    inviteCode,
    verificationPhone,
    verificationCode,
  })
  const account = agentToSessionAccountOrThrow(agent)
  const gates = features.refresh({strategy: 'prefer-fresh-gates'})
  const moderation = configureModerationForAccount(agent, account)

  const createdAt = new Date().toISOString()
  const birthdate = birthDate.toISOString()

  /*
   * Since we have a race with account creation, profile creation, and AA
   * state, set these values locally to ensure sync reads. Values are written
   * to the server in the next step, so on subsequent reloads, the server will
   * be the source of truth.
   */
  setCreatedAtForDid({did: account.did, createdAt})
  setBirthdateForDid({did: account.did, birthdate})
  snoozeBirthdateUpdateAllowedForDid(account.did)
  // do this last
  const aa = prefetchAgeAssuranceServerData({agent})

  /*
   * With onboarding skipped, the Home screen renders as soon as account
   * creation resolves, and its preferences fetch calls getPreferences. If
   * that runs before any savedFeeds pref exists on the server, @atproto/api
   * writes back a following-only default, clobbering the brand defaults.
   * So the feed seeding (and the brand follow, so the following feed is not
   * empty on first render) must complete before we return. Failures are
   * logged but do not block signup.
   */
  if (IS_PROD_SERVICE(service)) {
    await Promise.allSettled([
      networkRetry(2, () => {
        return agent.overwriteSavedFeeds(
          getActiveBrand().defaultFeeds.map(feed => ({
            ...feed,
            id: TID.nextStr(),
          })),
        )
      }).catch(e => {
        logger.error(
          `createAgentAndCreateAccount: failed to set initial feeds`,
          {safeMessage: e},
        )
      }),
      /*
       * Auto-follow the brand account. This used to happen at the end of
       * onboarding (StepFinished), which is now skipped entirely, so it
       * happens here as part of account setup instead.
       */
      networkRetry(2, () => {
        return agent.follow(getActiveBrand().appAccountDid)
      }).catch(e => {
        logger.error(
          `createAgentAndCreateAccount: failed to follow brand account`,
          {safeMessage: e},
        )
      }),
    ])
  }

  // Not awaited so that we can still get into the app quickly.
  // This is OK because we won't let you toggle adult stuff until you set the date.
  if (IS_PROD_SERVICE(service)) {
    void Promise.allSettled([
      networkRetry(3, () => {
        return agent.setPersonalDetails({
          birthDate: birthdate,
        })
      }).catch(e => {
        logger.info(`createAgentAndCreateAccount: failed to set birthDate`)
        throw e
      }),
      networkRetry(3, () => {
        return agent.upsertProfile(prev => {
          const next: Un$Typed<AppBskyActorProfile.Record> = prev || {}
          next.displayName = handle
          next.createdAt = createdAt
          return next
        })
      }).catch(e => {
        logger.info(
          `createAgentAndCreateAccount: failed to set initial profile`,
        )
        throw e
      }),
      // wait for AA data to load first, then check state
      aa.then(() => {
        const {flags} = unsafeGetAndComputeAgeAssurance({did: account.did})
        if (flags?.chatDisabled || flags?.groupChatDisabled) {
          void restrictChatSettings({
            agent,
            restrictIncoming: flags.chatDisabled,
            restrictGroupInvites: flags.groupChatDisabled,
          })
        }
      }),
    ]).then(promises => {
      const rejected = promises.filter(p => p.status === 'rejected')
      if (rejected.length > 0) {
        logger.error(
          `session: createAgentAndCreateAccount failed to save personal details and feeds`,
        )
      }
    })
  } else {
    void Promise.allSettled([
      networkRetry(3, () => {
        return agent.setPersonalDetails({
          birthDate: birthDate.toISOString(),
        })
      }).catch(e => {
        logger.info(`createAgentAndCreateAccount: failed to set birthDate`)
        throw e
      }),
      networkRetry(3, () => {
        return agent.upsertProfile(prev => {
          const next: Un$Typed<AppBskyActorProfile.Record> = prev || {}
          next.createdAt = prev?.createdAt || new Date().toISOString()
          return next
        })
      }).catch(e => {
        logger.info(
          `createAgentAndCreateAccount: failed to set initial profile`,
        )
        throw e
      }),
    ]).then(promises => {
      const rejected = promises.filter(p => p.status === 'rejected')
      if (rejected.length > 0) {
        logger.error(
          `session: createAgentAndCreateAccount failed to save personal details and feeds`,
        )
      }
    })
  }

  try {
    // snooze first prompt after signup, defer to next prompt
    snoozeEmailConfirmationPrompt()
  } catch (e: any) {
    logger.error(e, {message: `session: failed snoozeEmailConfirmationPrompt`})
  }

  agent.configureProxy(BLUESKY_PROXY_HEADER.get())

  return agent.prepare({
    resolvers: [gates, moderation, aa],
    onSessionChange,
  })
}

export function agentToSessionAccountOrThrow(agent: AtpAgent): SessionAccount {
  const account = agentToSessionAccount(agent)
  if (!account) {
    throw Error('Expected an active session')
  }
  return account
}

export function agentToSessionAccount(
  agent: AtpAgent,
): SessionAccount | undefined {
  if (!agent.session) {
    return undefined
  }
  return {
    service: agent.serviceUrl.toString(),
    did: agent.session.did,
    handle: agent.session.handle,
    email: agent.session.email,
    emailConfirmed: agent.session.emailConfirmed || false,
    emailAuthFactor: agent.session.emailAuthFactor || false,
    refreshJwt: agent.session.refreshJwt,
    accessJwt: agent.session.accessJwt,
    signupQueued: isSignupQueued(agent.session.accessJwt),
    active: agent.session.active,
    status: agent.session.status,
    pdsUrl: agent.pdsUrl?.toString(),
    isSelfHosted: !agent.serviceUrl.toString().startsWith(BSKY_SERVICE),
  }
}

export function sessionAccountToSession(
  account: SessionAccount,
): AtpSessionData {
  return {
    // Sorted in the same property order as when returned by BskyAgent (alphabetical).
    accessJwt: account.accessJwt ?? '',
    did: account.did,
    email: account.email,
    emailAuthFactor: account.emailAuthFactor,
    emailConfirmed: account.emailConfirmed,
    handle: account.handle,
    refreshJwt: account.refreshJwt ?? '',
    /**
     * @see https://github.com/bluesky-social/atproto/blob/c5d36d5ba2a2c2a5c4f366a5621c06a5608e361e/packages/api/src/agent.ts#L188
     */
    active: account.active ?? true,
    status: account.status,
  }
}

export class Agent extends BaseAgent {
  constructor(
    proxyHeader: ProxyHeaderValue | null,
    ...options: ConstructorParameters<typeof BaseAgent>
  ) {
    super(...options)
    if (proxyHeader) {
      this.configureProxy(proxyHeader)
    }
  }
}

// Not exported. Use factories above to create it.
// WARN: In the factories above, we _manually set a proxy header_ for the agent after we do whatever it is we are supposed to do.
// Ideally, we wouldn't be doing this. However, since there is so much logic that requires making calls to the PDS right now, it
// feels safer to just let those run as-is and set the header afterward.
let realFetch = globalThis.fetch
class BskyAppAgent extends AtpAgent {
  persistSessionHandler: ((event: AtpSessionEvent) => void) | undefined =
    undefined

  constructor({service}: {service: string}) {
    super({
      service,
      async fetch(...args) {
        let success = false
        try {
          const result = await realFetch(...args)
          success = true
          return result
        } catch (e) {
          success = false
          throw e
        } finally {
          if (success) {
            emitNetworkConfirmed()
          } else {
            emitNetworkLost()
          }
        }
      },
      persistSession: (event: AtpSessionEvent) => {
        if (this.persistSessionHandler) {
          this.persistSessionHandler(event)
        }
      },
    })
  }

  async prepare({
    resolvers,
    onSessionChange,
  }: {
    // Not awaited in the calling code so we can delay blocking on them.
    resolvers: Promise<unknown>[]
    onSessionChange: (
      agent: AtpAgent,
      did: string,
      event: AtpSessionEvent,
    ) => void
  }) {
    // There's nothing else left to do, so block on them here.
    await Promise.all(resolvers)

    // Now the agent is ready.
    const account = agentToSessionAccountOrThrow(this)
    this.persistSessionHandler = event => {
      onSessionChange(this, account.did, event)
      if (event !== 'create' && event !== 'update') {
        addSessionErrorLog(account.did, event)
      }
    }
    return {account, agent: this}
  }

  dispose() {
    this.sessionManager.session = undefined
    this.persistSessionHandler = undefined
  }
}

export type {BskyAppAgent}
