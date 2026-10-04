import React from "react";

export const SvgFromString = ({ svg }: { svg: string }) => {
  if (!svg) return null;

  return (
    <div
      // NOTE: only do this if you trust the source of the SVG
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};
