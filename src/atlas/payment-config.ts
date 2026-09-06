import { createAtlasTestnetPaymentConfig, type AtlasTestnetPaymentConfig } from '../../shared/atlas/payment-config';
import { ATLAS_LANTERN_PRICE_LUNA } from '../../shared/atlas/economy';

export function readAtlasClientPaymentConfig(): AtlasTestnetPaymentConfig {
  return createAtlasTestnetPaymentConfig({
    enabled: import.meta.env.VITE_ATLAS_TESTNET_ENABLED === 'true',
    recipient: import.meta.env.VITE_ATLAS_TESTNET_RECIPIENT,
    valueLuna: import.meta.env.VITE_ATLAS_TESTNET_PRICE_LUNA ?? String(ATLAS_LANTERN_PRICE_LUNA),
  });
}
