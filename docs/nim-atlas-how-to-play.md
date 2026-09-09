# How to play NIM Atlas

NIM Atlas is a short adventure about repairing a payment route. You learn by
walking to the problem, choosing an action, and seeing the city respond.

## Start here

1. Choose Explorer or Builder.
2. Enter Beacon Commons and follow the orange route marker.
3. Move to Mara's marker and talk to her.
4. Inspect the lantern request before choosing any payment action.
5. Compare the network, recipient, and amount.
6. Finish the route and watch the harbor state change.

The game uses Lunas because the chain records integer smallest units. One NIM is
100,000 Lunas. The practice lantern is 10,000 Lunas, which is 0.1 NIM.

## Explorer and Builder

Explorer follows the payment. You learn what a wallet request looks like and
why a callback or transaction hash still needs confirmation.

Builder repairs the route. You predict what the provider will return, keep the
request exact, and complete the safe provider trial before the route can open.

Both paths teach the same sequence:

| Verb | Player action | Lesson |
| --- | --- | --- |
| Ask | Choose the payment action | The app asks for wallet access at the moment it is needed. |
| Check | Inspect the request | Network, recipient, and amount must be readable. |
| Approve | Confirm in Nimiq Pay | The player gives permission. Approval is not payment proof. |
| Confirm | Wait for the matching chain record | A lookup or hash is not enough on its own. |
| Unlock | Fulfil the lantern once | The world changes after the required evidence matches. |

## Controls

- On mobile, use the movement pad on the left.
- Drag the look area to turn the camera.
- On desktop, use the keyboard to move and drag with the mouse to orbit.
- Use the city map and next-target card when the route marker leaves view.
- Pause or reduce motion from the top controls.

## Modes

Practice mode is free, local, and wallet-free. It uses a committed fixture and
does not send NIM.

The optional TestAlbatross path is a separate deployment capability. It asks
for approval only after the player reviews the exact request. Atlas then waits
for the server to match canonical evidence before fulfilling the mission.

## Current snapshots

<table>
  <tr>
    <td align="center" valign="top"><img src="shots/atlas-390-welcome.png" width="180" alt="NIM Atlas welcome"><br><sub>Welcome</sub></td>
    <td align="center" valign="top"><img src="shots/atlas-390-beacon-commons.png" width="180" alt="Beacon Commons city"><br><sub>Beacon Commons</sub></td>
    <td align="center" valign="top"><img src="shots/atlas-390-pay-harbor.png" width="180" alt="Pay Harbor mission"><br><sub>Pay Harbor</sub></td>
  </tr>
  <tr>
    <td align="center" valign="top"><img src="shots/atlas-390-payment-review.png" width="180" alt="Pay Harbor payment review"><br><sub>Payment review</sub></td>
    <td align="center" valign="top"><img src="shots/atlas-390-daily.png" width="180" alt="Daily Atlas puzzle"><br><sub>Daily Atlas</sub></td>
    <td align="center" valign="top"><img src="shots/atlas-390-district-atlas.png" width="180" alt="District Atlas"><br><sub>District Atlas</sub></td>
  </tr>
  <tr>
    <td align="center" valign="top"><img src="shots/atlas-390-core-run.png" width="180" alt="Verified Core Run"><br><sub>Verified Core Run</sub></td>
    <td></td>
    <td></td>
  </tr>
</table>

The snapshots come from `scripts/shoot-atlas.mjs`. They are regenerated against
the local production preview so a screenshot cannot silently describe a
different build.
