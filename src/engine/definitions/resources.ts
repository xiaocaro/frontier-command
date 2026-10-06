import { freezeDefinitions } from './freeze';
export const RESOURCE_DEFINITIONS = freezeDefinitions({
  materials: { label: 'Materials', price: 5 },

  photon: { label: 'Photon', price: 12 },
  quantum: { label: 'Quantum', price: 24 },
  specialFinds: { label: 'Special Finds', price: 150 },
});
