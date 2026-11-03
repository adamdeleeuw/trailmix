export function decodePolyline(encoded: string): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  function nextDelta(): number {
    let result = 0;
    let shift = 0;
    let chunk: number;
    do {
      if (index >= encoded.length) throw new Error('Truncated encoded polyline');
      chunk = encoded.charCodeAt(index++) - 63;
      if (chunk < 0 || chunk > 63) throw new Error('Invalid encoded polyline character');
      result |= (chunk & 0x1f) << shift;
      shift += 5;
    } while (chunk >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  }

  while (index < encoded.length) {
    latitude += nextDelta();
    if (index >= encoded.length) throw new Error('Encoded polyline has an incomplete coordinate pair');
    longitude += nextDelta();
    points.push([latitude / 1e5, longitude / 1e5]);
  }
  return points;
}
