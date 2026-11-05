"use client";
import presets from "../lib/market-presets.json";

const labels = {
  higher: "Higher output",
  middle: "Middle output",
  lower: "Lower output",
  priority: "Your three focus cities",
};
export default function MarketAreas({
  countries,
  tiers = ["higher", "middle", "lower"],
  areas = [],
  onChange,
  disabled = false,
}) {
  const selectedCountries = countries?.length
    ? countries
    : Object.keys(presets);
  function toggleArea(country, area, available) {
    const prefix = `${country}|`;
    const explicit = areas.filter((a) => a.startsWith(prefix));
    const current = explicit.length
      ? explicit
      : available.map((item) => `${country}|${item.area}`);
    const value = `${country}|${area}`;
    if (current.includes(value) && current.length === 1) return;
    const next = current.includes(value)
      ? current.filter((a) => a !== value)
      : [...current, value];
    onChange({
      tiers,
      areas: [...areas.filter((a) => !a.startsWith(prefix)), ...next],
    });
  }
  return (
    <div className="market-area-picker">
      <fieldset disabled={disabled}>
        <legend>Market tiers</legend>
        <div className="agent-focus-options">
          {["higher", "middle", "lower"].map((tier) => (
            <label key={tier}>
              <input
                type="checkbox"
                checked={tiers.includes(tier)}
                onChange={() => {
                  const next = tiers.includes(tier)
                    ? tiers.filter((v) => v !== tier)
                    : [...tiers, tier];
                  if (next.length) onChange({ tiers: next, areas: [] });
                }}
              />
              {labels[tier]}
            </label>
          ))}
        </div>
      </fieldset>
      <p className="market-area-note">
        Three areas per tier, with a starting city for each search. These are
        economic output presets, not ratings of individual businesses or their
        budgets. Nigeria always uses only Abuja, Lagos and Port Harcourt.
      </p>
      {selectedCountries
        .filter((country) => presets[country])
        .map((country) => {
          const market = presets[country];
          const groups = Object.entries(market.tiers).filter(
            ([tier]) => tier === "priority" || tiers.includes(tier),
          );
          const available = groups.flatMap(([, rows]) => rows);
          const explicit = areas.filter((a) => a.startsWith(`${country}|`));
          return (
            <details
              className="market-country"
              key={country}
              open={country === "Nigeria" || selectedCountries.length === 1}
            >
              <summary>
                {country}
                <small>
                  {market.unit} · {available.length} available areas
                </small>
              </summary>
              {groups.map(([tier, rows]) => (
                <fieldset key={tier} disabled={disabled}>
                  <legend>{labels[tier]}</legend>
                  <div className="market-area-grid">
                    {rows.map((item) => (
                      <label key={item.area}>
                        <input
                          type="checkbox"
                          checked={
                            !explicit.length ||
                            explicit.includes(`${country}|${item.area}`)
                          }
                          onChange={() =>
                            toggleArea(country, item.area, available)
                          }
                        />
                        <span>
                          <strong>{item.area}</strong>
                          {item.city !== item.area && (
                            <small>Start in {item.city.split(",")[0]}</small>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
              {!!market.sources.length && (
                <div className="market-sources">
                  Preset context:{" "}
                  {market.sources.map((source) => (
                    <a
                      key={source.url}
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {source.title}
                    </a>
                  ))}
                </div>
              )}
            </details>
          );
        })}
    </div>
  );
}
