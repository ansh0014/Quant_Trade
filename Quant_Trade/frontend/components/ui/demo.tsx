"use client"

import LoadingFillText from "@/components/ui/motion-loading-fill-text"

export default function Default() {
  return (
    <div className="motion-example flex w-full items-center justify-center p-8">
      <LoadingFillText label="LOADING" />
    </div>
  )
}

