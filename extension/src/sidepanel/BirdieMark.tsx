// The Birdie avatar, cropped the same way as the web app's launcher and panel header.
export function BirdieMark({ size = 32 }: { size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center overflow-hidden rounded-full border border-[#2d9e6b]/40 bg-[#fff8d8]"
      style={{ width: size, height: size }}
    >
      <img alt="" aria-hidden="true" className="h-auto w-[250%] max-w-none" src={chrome.runtime.getURL('Birdie.png')} />
    </span>
  )
}
