import { Zone } from "../models/Zone";

export const SEARCH_RADIUS_METERS = 3000;

interface AreaCoordinates {
  name: string;
  latitude: number;
  longitude: number;
}

export function generateLocationZones(
  area: AreaCoordinates,
  radius = SEARCH_RADIUS_METERS
): Zone[] {
  return [
    {
      town: area.name,
      name: area.name,
      latitude: area.latitude,
      longitude: area.longitude,
      radius,
    },
  ];
}
