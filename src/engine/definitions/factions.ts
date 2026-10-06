import { freezeDefinitions } from './freeze';
export const FACTIONS = freezeDefinitions({
  starfleet: { name: 'Federation' },
  orion: { name: 'Orion Syndicate' },
  romulan: { name: 'Romulan' },
});
