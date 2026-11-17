/**
 * How much water vapour air can hold before it condenses (saturation).
 * Clausius–Clapeyron, Magnus approximation: roughly +7 % per °C, so warm air
 * holds far more water than cold air (30 °C: ~27 g/kg; 0 °C: ~3.8 g/kg).
 * That single fact explains a lot: humid air pushed over colder ground (or up
 * a mountain) must drop its excess water as rain or snow.
 *
 * Returns specific humidity at saturation, g of water per kg of air, at sea-level pressure.
 */
export function saturationHumidityGPerKg(temperatureC: number): number {
  return 3.75 * Math.exp((17.67 * temperatureC) / (temperatureC + 243.5));
}
