export const A4_PX = 1123 // 297 mm at 96 dpi
export const ONE_PAGE_WARNING = 'This runs past one page. Trim it before saving.'

/**
 * True when the CV is taller than one A4 page. offsetHeight is the layout height,
 * so a CSS transform scale on an ancestor (the review preview) does not change it.
 */
export function runsPastOnePage(root: ParentNode = document): boolean {
  const sheet = root.querySelector<HTMLElement>('.cv')
  return !!sheet && sheet.offsetHeight > A4_PX + 2
}
