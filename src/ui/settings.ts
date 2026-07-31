/**
 * Settings. Currently one decision, which is the point.
 *
 * A settings screen is where features go to hide, so this holds only things a
 * player genuinely needs to change about how the game responds to them, and
 * nothing that is really a preference we were too undecided to make.
 *
 * Sound and fullscreen stay on the brief where they already are: those are
 * one-tap toggles you reach for mid-session, and burying them a level deeper
 * to tidy the home page would be a worse app arranged more neatly.
 */

import { networkLabel, onTestnet, setNetwork, TESTNET_FAUCET } from '../core/network';
import { claimFaucet, faucetInfo, type FaucetInfo } from '../net/faucet';
import { button, el, mount } from './dom';
import {
  SCHEME_LABEL,
  SCHEME_SAY,
  scheme,
  setScheme,
  touchCapable,
  type Scheme,
} from '../core/scheme';

export interface SettingsOptions {
  onBack: () => void;
  /** Re-render, so the chosen row updates under the thumb that chose it. */
  onChange: () => void;
  /**
   * The connected wallet's address, when there is one.
   *
   * Prefilled into the faucet field so the common case is one tap. Somebody
   * playing in a browser can still paste an address in by hand, which is the
   * whole reason the field is a field and not a label.
   */
  address?: string | null;
}

const ORDER: Scheme[] = ['touch', 'analog', 'dpad'];

export function renderSettings(root: HTMLElement, options: SettingsOptions): void {
  const active = scheme();

  mount(
    root,
    el(
      'div',
      { class: 'screen settings' },

      el('p', { class: 'eyebrow', text: 'Settings' }),
      el('h1', { text: 'How you fly' }),
      el('p', {
        class: 'guide__lead',
        text: 'Both schemes are always available on a phone. This only decides which one is listening.',
      }),

      /*
       * Said plainly rather than hiding the rows.
       *
       * Hiding them on a desktop would leave somebody who set pads on their
       * phone unable to find the setting they know exists, and would make the
       * screen look like it had lost something. The choice is still saved and
       * still applies the moment they pick the phone back up.
       */
      !touchCapable()
        ? el('div', {
            class: 'notice',
            text: 'You are on a keyboard, so the pads stay off and WASD flies. Pick one anyway and it will be waiting on your phone.',
          })
        : null,

      el(
        'div',
        { class: 'schemes' },
        ...ORDER.map((id) => schemeRow(id, id === active, options)),
      ),

      /*
       * The landscape note.
       *
       * Not enforced. Locking orientation in a WebView is unreliable and
       * fighting the player's rotation lock is worse than a sentence. The game
       * is playable in portrait and better in landscape, so say that and let
       * them decide.
       */
      el('p', {
        class: 'settings__note',
        text: 'Turn the phone sideways if you can. The level runs left to right, so landscape shows you more of what is coming and puts both controls under your thumbs.',
      }),

      /*
       * Which network this is, said in words rather than left to a chip.
       *
       * The chip in the bar is four characters and a dot, which is enough to
       * notice and not enough to explain. Somebody who wants to know what the
       * difference actually means comes here, and the difference matters: it
       * decides whether the NIM in a stake is real.
       */
      el(
        'div',
        { class: 'settings__net' },
        el('p', { class: 'settings__nethead', text: `NETWORK: ${networkLabel().toUpperCase()}` }),
        el('p', {
          class: 'settings__netsay',
          text: onTestnet()
            ? 'Testnet. The game is identical, but NIM here is worth nothing, scores stay off the daily board, and CT Signals is off because it reads live X. Use it to rehearse a challenge without spending anything.'
            : 'Mainnet. Real NIM, the real daily board, and live reads of crypto X. This is the game.',
        }),
        onTestnet() ? faucetCard(options.address ?? null) : null,
        button(
          onTestnet() ? 'Switch to Mainnet' : 'Switch to Testnet',
          () => setNetwork(onTestnet() ? 'main' : 'test'),
          'ghost',
        ),
      ),

      el('div', { class: 'actions' }, button('Done', options.onBack)),
    ),
  );
}

function schemeRow(id: Scheme, active: boolean, options: SettingsOptions): HTMLElement {
  const node = el(
    'button',
    {
      class: active ? 'scheme scheme--on' : 'scheme',
      type: 'button',
      // Announced as a choice within a set, not as three unrelated buttons.
      role: 'radio',
      'aria-checked': active ? 'true' : 'false',
    },
    el(
      'div',
      { class: 'scheme__body' },
      el('p', { class: 'scheme__name', text: SCHEME_LABEL[id] }),
      el('p', { class: 'scheme__say', text: SCHEME_SAY[id] }),
    ),
    el('span', { class: 'scheme__mark', text: active ? 'ON' : '' }),
  );

  node.addEventListener('click', () => {
    setScheme(id);
    options.onChange();
  });

  return node;
}

/**
 * Claim testnet NIM without leaving the game.
 *
 * This replaced a link out to the faucet's own page, which serves a twelve byte
 * body and renders blank. Following our own link and finding nothing is worse
 * than not offering it, so the claim happens here against the same API that
 * page would have used. See net/faucet.ts.
 */
function faucetCard(address: string | null): HTMLElement {
  const field = el('input', {
    class: 'settings__faucetfield',
    type: 'text',
    spellcheck: 'false',
    autocomplete: 'off',
    placeholder: 'NQ...',
    value: address ?? '',
    'aria-label': 'Address to receive testnet NIM',
  }) as HTMLInputElement;

  const status = el('p', { class: 'settings__faucetsay', text: 'Checking the faucet...' });
  const action = button('Claim testnet NIM', () => void claim(), 'ghost');

  const card = el(
    'div',
    { class: 'settings__faucet' },
    el('p', { class: 'settings__faucethead', text: 'TESTNET NIM' }),
    field,
    action,
    status,
    /*
     * Their page is still linked, quietly, at the bottom.
     *
     * It is broken today and may not be tomorrow, and it is their faucet: if
     * this stops working, the honest thing is that the player can still go
     * straight to the source rather than being stuck behind our copy of it.
     */
    el(
      'a',
      {
        class: 'settings__faucetlink',
        href: TESTNET_FAUCET,
        target: '_blank',
        rel: 'noopener noreferrer',
      },
      'Or open the Nimiq faucet directly',
    ),
  );

  /*
   * What the faucet has left, asked once when the card is built.
   *
   * Worth showing rather than hiding: a faucet runs dry, and "none left today"
   * is a completely different problem from "your address was refused". Someone
   * who can see the difference stops debugging their own wallet.
   */
  let dispenseNim: number | null = null;

  void faucetInfo().then((info: FaucetInfo | null) => {
    if (!info) {
      status.textContent = 'Could not reach the faucet just now. The link below still works.';
      return;
    }
    if (!info.available) {
      status.textContent = 'The faucet is not serving this region.';
      return;
    }
    dispenseNim = info.dispenseNim;
    status.textContent = `Pays ${info.dispenseNim} NIM. ${info.remaining.toLocaleString()} claims left.`;
  });

  async function claim(): Promise<void> {
    action.setAttribute('disabled', 'true');
    status.textContent = 'Asking the faucet...';

    const result = await claimFaucet(field.value);

    /*
     * The amount comes from whichever source actually knows it.
     *
     * The faucet's success body is usually just `{ success: true }`, so the
     * figure comes from the dispense amount it published a moment ago. If
     * neither is available the sentence simply does not carry a number, which
     * is better than the "Sent 0 NIM" this used to print when it read a missing
     * field as zero.
     */
    const sent = result.ok ? (result.nim ?? dispenseNim) : null;

    // Its own words when it refused. The faucet knows why far better than we
    // can guess, and its reasons are specific enough to act on.
    status.textContent = result.ok
      ? sent === null
        ? 'Sent. It lands in a moment.'
        : `Sent ${sent} NIM. It lands in a moment.`
      : result.reason;

    action.removeAttribute('disabled');
  }

  return card;
}