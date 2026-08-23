"use client";

import React, { useState } from "react";
import { categoryIcon } from "@/lib/categories";

interface CategoryIconProps {
  category: string | null | undefined;
  className?: string;
}

const FALLBACK = "/misc.svg";

/**
 * A category's icon, with a fallback for anything unrecognised.
 *
 * `categoryIcon` already maps an unknown category to misc.svg, so a broken
 * image should be impossible — but that reasoning depends on public/ and the
 * Category enum staying in step. If a category's svg is ever deleted or
 * renamed, a bare <img> renders the browser's broken-image glyph inside the
 * transaction table. This swaps to misc.svg on the load error instead.
 */
export default function CategoryIcon({ category, className = "" }: CategoryIconProps) {
  const [failed, setFailed] = useState(false);
  const src = failed ? FALLBACK : categoryIcon(category);

  return (
    <img
      src={src}
      alt={category ?? "Uncategorized"}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
