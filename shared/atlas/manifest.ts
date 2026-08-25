import type { AtlasCurriculum, AtlasSource, AtlasTrial } from './types';

const REVIEWED_AT = '2026-08-25';
const providerSource = source('https://nimiq.dev/mini-apps/api-reference/nimiq-provider', 'Nimiq Provider API');
const miniAppsSource = source('https://nimiq.dev/mini-apps/', 'Nimiq Mini Apps');
const webClientSource = source('https://nimiq.dev/web-client/getting-started', 'Nimiq Web Client getting started');
const clientSource = source('https://nimiq.dev/web-client/reference/classes/client', 'Nimiq Client reference');
const lightClientSource = source('https://nimiq.dev/web-client/concepts/how-the-light-client-works', 'How the Nimiq light client works');
const protocolSource = source('https://nimiq.dev/protocol/', 'Nimiq proof-of-stake protocol');

function source(url: string, title: string): AtlasSource {
  return { url, title, reviewedAt: REVIEWED_AT };
}

function trial(value: AtlasTrial): AtlasTrial {
  return value;
}

export const ATLAS_CURRICULUM: AtlasCurriculum = {
  version: 1,
  reviewedAt: REVIEWED_AT,
  districts: [
    {
      id: 'genesis-garden', title: 'Genesis Garden', accent: '#f7931a',
      summary: 'Restore address paths while learning how NIM values and account identities are represented.',
      encounters: [{ id: 'garden-courier', title: 'The lost courier', objective: 'Scan the address stones and reconnect the courier to the matching route.', tool: 'scanner', knowledge: 'Nimiq addresses identify accounts, while amounts are represented as integer Lunas.' }],
      trials: [
        trial({ id: 'luna-lens', title: 'Luna lens', objective: 'Convert an exact NIM amount into integer Lunas without rounding money paths.', operation: 'nim-luna-convert', capability: 'local', enabled: true, ownerGate: false, source: providerSource, acceptedObservation: '1 NIM equals exactly 100000 Lunas.', explanation: 'Nimiq transaction values use integer Lunas. Integer arithmetic avoids hidden decimal rounding.', recipe: { language: 'typescript', code: "const LUNAS_PER_NIM = 100_000\nconst lunas = 12 * LUNAS_PER_NIM" } }),
        trial({ id: 'address-compass', title: 'Address compass', objective: 'Recognize a user-friendly Nimiq address before using it as a destination.', operation: 'validate-address', capability: 'local', enabled: true, ownerGate: false, source: webClientSource, acceptedObservation: 'A parsed address can be rendered in Nimiq user-friendly form.', explanation: 'Validate addresses locally before constructing a request, then let the wallet confirm the final destination.', recipe: { language: 'typescript', code: "import init, * as Nimiq from '@nimiq/core/web'\nawait init()\nconst address = Nimiq.Address.fromUserFriendlyAddress(input)" } }),
      ],
    },
    {
      id: 'light-forest', title: 'Light Forest', accent: '#5bb98c',
      summary: 'Reconnect light paths by observing provider readiness, consensus, and the current block height.',
      encounters: [{ id: 'forest-lightpath', title: 'The missing lightpath', objective: 'Tether three light relays only after the network reports a usable view.', tool: 'relay-tether', knowledge: 'Consensus indicates whether the client has a sufficiently current view of the network.' }],
      trials: [
        trial({ id: 'provider-awakening', title: 'Provider awakening', objective: 'Initialize the injected Nimiq provider without prompting for an account.', operation: 'provider-init', capability: 'provider-read', enabled: true, ownerGate: false, source: miniAppsSource, acceptedObservation: 'Initialization returns a provider or an honest unavailable state.', explanation: 'The init helper waits for Nimiq Pay to inject its provider. It does not prove account ownership.', recipe: { language: 'typescript', code: "import { init } from '@nimiq/mini-app-sdk'\nconst nimiq = await init({ timeout: 2500 })" } }),
        trial({ id: 'consensus-canopy', title: 'Consensus canopy', objective: 'Read consensus and block height without asking the player to sign or spend.', operation: 'consensus-status', capability: 'provider-read', enabled: true, ownerGate: false, source: lightClientSource, acceptedObservation: 'Consensus is a boolean and block height is a non-negative integer.', explanation: 'Consensus and block height are read-only observations. An unavailable reading is not the same as zero.', recipe: { language: 'typescript', code: "const ready = await nimiq.isConsensusEstablished()\nconst height = await nimiq.getBlockNumber()" } }),
        trial({ id: 'block-beacon', title: 'Block beacon', objective: 'Compare two current block readings and identify the newer network view.', operation: 'block-number', capability: 'provider-read', enabled: true, ownerGate: false, source: providerSource, acceptedObservation: 'The later valid height is greater than or equal to the earlier height.', explanation: 'Block heights order the chain view, but a height alone does not prove a payment.', recipe: { language: 'typescript', code: "const firstHeight = await nimiq.getBlockNumber()\nconst nextHeight = await nimiq.getBlockNumber()" } }),
      ],
    },
    {
      id: 'pay-harbor', title: 'Pay Harbor', accent: '#f6c85f',
      summary: 'Repair merchant routes with explicit account approval, signed messages, and safe payment construction.',
      encounters: [{ id: 'harbor-merchant', title: 'The stranded merchant', objective: 'Scan the requested recipient and amount, then shield the route from substitution.', tool: 'shield-pulse', knowledge: 'A player must review the recipient and exact Luna amount in the wallet before any send.' }],
      trials: [
        trial({ id: 'account-manifest', title: 'Account manifest', objective: 'Request account access only after the player chooses a wallet-backed action.', operation: 'list-accounts', capability: 'wallet-sign', enabled: true, ownerGate: false, source: providerSource, acceptedObservation: 'The result is an approved address list or a clear rejection.', explanation: 'Account access is a user-confirmed capability and must not run during app boot.', recipe: { language: 'typescript', code: 'const accounts = await nimiq.listAccounts()\nconst selectedAddress = accounts[0] ?? null' } }),
        trial({ id: 'harbor-handshake', title: 'Harbor handshake', objective: 'Sign a purpose-bound challenge without creating a transaction.', operation: 'sign-challenge', capability: 'wallet-sign', enabled: true, ownerGate: false, source: providerSource, acceptedObservation: 'The wallet returns a public key and signature or an explicit rejection.', explanation: 'A signed challenge can prove control of a key for one purpose. It is not a device identifier and it is not payment proof.', recipe: { language: 'typescript', code: "const signed = await nimiq.sign('NIM Atlas builder trial')\nconst { publicKey, signature } = signed" } }),
        trial({ id: 'payment-blueprint', title: 'Payment blueprint', objective: 'Construct and review a typed payment request without sending it.', operation: 'prepare-basic-payment', capability: 'local', enabled: true, ownerGate: false, source: providerSource, acceptedObservation: 'The blueprint contains a validated recipient and integer Luna value.', explanation: 'Construction is local. Sending requires a separate wallet confirmation and later chain verification.', recipe: { language: 'typescript', code: "const payment = { recipient: validatedAddress, value: 100_000 }\n// Review this object before any wallet method is called." } }),
      ],
    },
    {
      id: 'albatross-causeway', title: 'Albatross Causeway', accent: '#e7644a',
      summary: 'Guide evidence across confirmation spans and distinguish wallet replies from canonical chain receipts.',
      encounters: [{ id: 'causeway-crossing', title: 'The confirmation crossing', objective: 'Shield a receipt until its sender, recipient, value, success, and confirmations agree.', tool: 'shield-pulse', knowledge: 'A transaction hash locates evidence. It does not itself prove canonical successful payment.' }],
      trials: [
        trial({ id: 'receipt-inspector', title: 'Receipt inspector', objective: 'Evaluate canonical transaction evidence rather than trusting a wallet reply.', operation: 'inspect-transaction-receipt', capability: 'server-read', enabled: true, ownerGate: false, source: clientSource, acceptedObservation: 'Network, inclusion, sender, recipient, value, success, and confirmations all match.', explanation: 'A wallet reply is not proof of canonical payment. Verification must read authoritative chain evidence.', recipe: { language: 'typescript', code: "const evidence = await verifiedChainReader.getTransaction(hash)\nconst paid = evidence.canonical && evidence.success && evidence.confirmations >= minimumConfirmations" } }),
        trial({ id: 'finality-span', title: 'Finality span', objective: 'Explain why a successful-looking reply can remain confirming or unknown.', operation: 'explain-confirmations', capability: 'local', enabled: true, ownerGate: false, source: protocolSource, acceptedObservation: 'The status stays confirming until the configured canonical evidence threshold.', explanation: 'Temporary RPC failure, missing inclusion, or insufficient confirmations must never become verified.', recipe: { language: 'typescript', code: "const status = canonical && confirmations >= minimumConfirmations\n  ? 'verified'\n  : 'confirming'" } }),
      ],
    },
    {
      id: 'validator-peaks', title: 'Validator Peaks', accent: '#9b7ede',
      summary: 'Stabilize validator relays while learning how validators, stakers, and delegation relate.',
      encounters: [{ id: 'peaks-relay', title: 'The silent validator relay', objective: 'Scan validator state and tether delegation to an eligible destination.', tool: 'relay-tether', knowledge: 'Validators operate consensus while stakers can delegate support through the staking contract.' }],
      trials: [
        trial({ id: 'validator-scope', title: 'Validator scope', objective: 'Read validator information without changing stake.', operation: 'inspect-validator', capability: 'provider-read', enabled: true, ownerGate: false, source: clientSource, acceptedObservation: 'The client returns validator state or an honest unavailable result.', explanation: 'Reading validator state is separate from authorizing a staking transaction.', recipe: { language: 'typescript', code: "const validator = await client.getValidator(validatorAddress)\nconst staker = await client.getStaker(stakerAddress)" } }),
        trial({ id: 'delegation-blueprint', title: 'Delegation blueprint', objective: 'Prepare a TestAlbatross delegation and identify the exact wallet approval boundary.', operation: 'prepare-delegation', capability: 'local', enabled: true, ownerGate: false, source: providerSource, acceptedObservation: 'The blueprint contains a validated validator address and no automatic send.', explanation: 'The game can teach the parameters without moving stake. Execution is a separate owner-gated TestAlbatross action.', recipe: { language: 'typescript', code: "const update = { newDelegation: validatorAddress, reactivateAllStake: false }\n// Do not call a send method during this local trial." } }),
        trial({ id: 'testnet-stake-gate', title: 'Testnet stake gate', objective: 'Demonstrate the separate approval required before any TestAlbatross transaction.', operation: 'send-testnet-payment', capability: 'testnet-send', enabled: false, ownerGate: true, source: providerSource, acceptedObservation: 'Disabled until an owner approves the exact network, recipient, value, and action.', explanation: 'The wallet response remains ambiguous until chain verification. This trial cannot run automatically.', recipe: { language: 'typescript', code: "const walletReply = await nimiq.sendBasicTransaction({ recipient, value })\n// A wallet reply is not proof of canonical payment." } }),
      ],
    },
    {
      id: 'builder-city', title: 'Builder City', accent: '#4e9ccf',
      summary: 'Restore city services by composing Nimiq Mini App capabilities behind honest user decisions.',
      encounters: [{ id: 'builder-service', title: 'The interrupted service', objective: 'Scan a service request and connect only the capabilities it truly needs.', tool: 'scanner', knowledge: 'Mini Apps should request accounts, signatures, or transactions only at the moment the player chooses that action.' }],
      trials: [
        trial({ id: 'capability-map', title: 'Capability map', objective: 'Map read, account, signing, and transaction methods to their confirmation requirements.', operation: 'map-provider-capabilities', capability: 'local', enabled: true, ownerGate: false, source: providerSource, acceptedObservation: 'Every method is classified as no-confirmation, user-confirmed, or owner-gated.', explanation: 'Capability mapping prevents accidental wallet prompts and hidden sends.', recipe: { language: 'typescript', code: "const capabilities = {\n  getBlockNumber: 'read',\n  listAccounts: 'user-confirmed',\n  sign: 'user-confirmed',\n  sendBasicTransaction: 'wallet-and-chain-verified',\n}" } }),
        trial({ id: 'mini-app-flow', title: 'Mini App flow', objective: 'Compose initialization, an honest read, and an optional signed action with recovery states.', operation: 'compose-mini-app-flow', capability: 'local', enabled: true, ownerGate: false, source: miniAppsSource, acceptedObservation: 'The flow remains useful when the provider is unavailable or the player declines.', explanation: 'A resilient Mini App keeps local value available and labels wallet-dependent actions honestly.', recipe: { language: 'typescript', code: "const nimiq = await init({ timeout: 2500 })\nconst ready = await nimiq.isConsensusEstablished()\n// Ask for accounts only after the user chooses a wallet action." } }),
      ],
    },
  ],
  finale: {
    id: 'beacon-core', title: 'Beacon Core', summary: 'Install the six recovered systems as one honest Nimiq Mini App flow.',
    requiredDistricts: ['genesis-garden', 'light-forest', 'pay-harbor', 'albatross-causeway', 'validator-peaks', 'builder-city'],
    encounters: [{ id: 'beacon-installation', title: 'The final installation', objective: 'Tether all six district systems and shield every authority boundary.', tool: 'relay-tether', knowledge: 'A trustworthy app separates local play, wallet intent, server replay, and canonical chain proof.' }],
    trials: [trial({ id: 'beacon-component', title: 'Beacon component', objective: 'Install a component only after all required observations and proofs are present.', operation: 'install-beacon-component', capability: 'local', enabled: true, ownerGate: false, source: miniAppsSource, acceptedObservation: 'The component records sourced learning and verified proof without claiming payment.', explanation: 'The finale composes capabilities but preserves every trust boundary learned in the districts.', recipe: { language: 'typescript', code: "const component = { districtSeals, sourcedRecipes, verifiedTrials }\nconst canInstall = requiredDistricts.every((id) => districtSeals.includes(id))" } })],
  },
  expeditions: [
    { id: 'expedition-light-route', title: 'Light Route Recovery', districtIds: ['light-forest'], lessonTrialIds: ['consensus-canopy', 'block-beacon'], ruleset: 'atlas-expedition-1' },
    { id: 'expedition-safe-harbor', title: 'Safe Harbor Run', districtIds: ['pay-harbor', 'albatross-causeway'], lessonTrialIds: ['payment-blueprint', 'receipt-inspector'], ruleset: 'atlas-expedition-1' },
    { id: 'expedition-beacon-build', title: 'Beacon Build', districtIds: ['validator-peaks', 'builder-city'], lessonTrialIds: ['delegation-blueprint', 'mini-app-flow'], ruleset: 'atlas-expedition-1' },
  ],
};
