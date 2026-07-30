import { Zone } from "../models/Zone";

interface TownInput {
  name: string;

  latitude: number;

  longitude: number;
}

export function generateZones(town: TownInput, radius = 3000): Zone[] {
  const offset = 0.03;

  return [
    {
      town: town.name,
      name: `${town.name}-center`,
      latitude: town.latitude,
      longitude: town.longitude,
      radius,
    },

    {
      town: town.name,
      name: `${town.name}-north`,
      latitude: town.latitude + offset,
      longitude: town.longitude,
      radius,
    },

    {
      town: town.name,
      name: `${town.name}-south`,
      latitude: town.latitude - offset,
      longitude: town.longitude,
      radius,
    },

    {
      town: town.name,
      name: `${town.name}-east`,
      latitude: town.latitude,
      longitude: town.longitude + offset,
      radius,
    },

    {
      town: town.name,
      name: `${town.name}-west`,
      latitude: town.latitude,
      longitude: town.longitude - offset,
      radius,
    },
  ];
}
