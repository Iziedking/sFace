# NIM Atlas: how to play

Sface is a Nimiq Pay Mini App game. NIM Atlas is the network you repair by
playing.

## Choose → Walk → Learn → Change

1. **Choose.** Pick Explorer to use the network, or Builder to repair the route.
2. **Walk.** Move through Pay Harbor until you find Mara's problem.
3. **Check.** Confirm who gets the NIM and the exact amount before you approve.
4. **Change.** Find the matching network record and watch the district respond.

The first adventure is **The Last Lantern**. Mara needs one safe NIM payment
route before the harbor market opens. Explorers visit the shop and review the
lantern purchase. Builders repair the payment request and network check. Both
paths meet at the same visible restoration.

**Lunas are the smallest units of NIM.** 1 NIM = 100,000 Lunas, so Mara's
0.1 NIM lantern costs 10,000 Lunas. Approving gives the payment permission;
the current network record proves whether the shop received it.

## Where Nimiq matters

| Play moment | Nimiq lesson |
| --- | --- |
| Ask | The Mini App requests wallet access only when the player chooses the payment action. |
| Check | The request shows who gets the NIM and the exact amount in NIM and Lunas. |
| Approve | The player gives permission in Nimiq Pay. Approval alone is not proof of payment. |
| Confirm | Atlas waits for a current network record matching the shop and amount. |
| Unlock | The lantern is fulfilled once, and the harbor changes. |

Practice mode is free and wallet-free. It teaches the route with a local fixture;
it does not send NIM or create payment proof. In a separately enabled testnet
journey, the browser still treats a wallet callback or transaction hash as a
lookup only. The server must verify a current network record before a payment
can unlock the world.

## Three moments to recognize

![Mara's Pay Harbor mission](shots/atlas-390-pay-harbor.png)

*Need: Mara's harbor has a human problem.*

![The Nimiq Pay request review](shots/atlas-430-payment-review.png)

*Check: the player sees the exact network, recipient, and Lunas.*

![The NIM Atlas path choice](shots/atlas-390-welcome.png)

*Choice: Explorer and Builder learn the same system from different sides.*

For implementation depth, use the official [Nimiq Provider API](https://nimiq.dev/mini-apps/api-reference/nimiq-provider)
and [Nimiq Mini Apps guide](https://nimiq.dev/mini-apps/). The in-game Living
Knowledge Book turns these five verbs into short playable trials.
