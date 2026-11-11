import { useState } from "react";
import { useApp } from "@/lib/store";

export function SavedUpstreamAddresses() {
  const settings = useApp((s) => s.settings);
  const patch = useApp((s) => s.patchSettings);
  const [showSavedAddresses, setShowSavedAddresses] = useState(false);
  const savedAddresses = settings.savedUpstreamAddresses ?? [];
  const currentAddress = settings.customBaseUrl.trim().replace(/\/+$/, "");

  return (
    <>
    <div className="mb-2 flex flex-wrap gap-2">
      <button type="button" className="k-btn" aria-expanded={showSavedAddresses}
        onClick={() => setShowSavedAddresses((open) => !open)}>已保存地址</button>
      <button type="button" className="k-btn"
        disabled={!/^https?:\/\/[^\s]+$/i.test(currentAddress) || savedAddresses.includes(currentAddress)}
        onClick={() => patch({ savedUpstreamAddresses: [currentAddress, ...savedAddresses] })}>
        保存此地址
      </button>
    </div>
    {showSavedAddresses && (
      <div className="mb-2 flex flex-col gap-1">
        {!savedAddresses.length && <span className="text-sm text-muted">还没有保存的地址</span>}
        {savedAddresses.map((address) => (
          <button key={address} type="button" className="k-row break-all"
            aria-pressed={address === currentAddress}
            onClick={() => {
              if (address !== currentAddress) patch({
                customBaseUrl: address, customApiKey: "", upstreamModel: "", upstreamModels: [],
              });
              setShowSavedAddresses(false);
            }}>
            {address}
          </button>
        ))}
      </div>
    )}
    </>
  );
}
