import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const HotspotApp = lazy(() => import("../hotspot/App"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AURA-RAD | Radiological Plume & Dose Modeling Studio" },
      {
        name: "description",
        content:
          "Model atmospheric radionuclide releases: Gaussian plume dispersion, cloudshine, inhalation and groundshine doses, and protective action zones.",
      },
      { property: "og:title", content: "AURA-RAD | Radiological Plume & Dose Modeling Studio" },
      {
        property: "og:description",
        content:
          "Gaussian plume dispersion and radiological dose assessment with Pasquill-Gifford coefficients and EPA protective action guides.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <ClientOnly
      fallback={
        <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
          Loading dispersion engine…
        </div>
      }
    >
      <Suspense
        fallback={
          <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
            Loading dispersion engine…
          </div>
        }
      >
        <HotspotApp />
      </Suspense>
    </ClientOnly>
  );
}
