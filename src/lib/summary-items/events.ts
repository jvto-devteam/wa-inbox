/**
 * Event jendela yang dikirim halaman /summary sesudah antrean berubah (jadwalkan, lepas, buat
 * ulang). Lencana menu di AppRail mendengarkannya supaya angkanya ikut turun seketika, bukan
 * menunggu putaran 60 detik berikutnya. Modul sendiri supaya AppRail -- yang ada di setiap
 * halaman -- tidak perlu mengimpor komponen antrean hanya demi satu string.
 */
export const SUMMARY_ITEMS_CHANGED = 'summary-items:changed'

export function announceSummaryItemsChanged(): void {
  window.dispatchEvent(new Event(SUMMARY_ITEMS_CHANGED))
}
