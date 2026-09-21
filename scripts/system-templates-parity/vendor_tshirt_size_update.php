<?php
// Parity: vendor_tshirt_size_update — new-backoffice BookingController::notifyTshirtVendor.
// Copies the size text, trip date and message lines.

function build($booking, $customerName, array $newSizes, $channel): string
{
// --- verbatim: new-backoffice/app/Http/Controllers/BookingController.php:2800-2800 ---
        $sizeKeys = ['xss', 'xxs', 'xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl'];
// --- end verbatim ---
// --- verbatim: new-backoffice/app/Http/Controllers/BookingController.php:2813-2821 ---
        $sizeLines = [];
        foreach ($sizeKeys as $key) {
            $qty = (int) ($newSizes[$key] ?? 0);
            if ($qty > 0) {
                $sizeLines[] = strtoupper($key) . ' x ' . $qty;
            }
        }
        $sizeText = count($sizeLines) ? implode('; ', $sizeLines) : '-';
        $tripDate = $booking->travel_date_start ? date('d M Y', strtotime($booking->travel_date_start)) : '-';
// --- end verbatim ---
        $dataSending = [];
// --- verbatim: new-backoffice/app/Http/Controllers/BookingController.php:2826-2826 ---
        $dataSending['message'] = "*🎽 Update Size T-Shirt*\r\n\r\nNama Customer: " . ($customerName ?: '-') . "\r\nTanggal Trip: " . $tripDate . "\r\nChannel: " . ($channel ?: '-') . "\r\nSize: " . $sizeText;
// --- end verbatim ---
    return $dataSending['message'];
}

$booking = (object) ['travel_date_start' => '2026-10-12'];
$sizes = ['xss' => 0, 'xxs' => 0, 'xs' => 0, 's' => 1, 'm' => 2, 'l' => 0, 'xl' => 1, 'xxl' => 0, 'xxxl' => 0];

echo json_encode([
    [
        'variables' => ['customer_name' => 'John Doe', 'trip_date' => '12 Oct 2026', 'channel' => 'JVTO', 'sizes' => 'S x 1; M x 2; XL x 1'],
        'text' => build($booking, 'John Doe', $sizes, 'JVTO'),
    ],
    [
        'variables' => ['customer_name' => '-', 'trip_date' => '-', 'channel' => 'KLOOK', 'sizes' => '-'],
        'text' => build((object) ['travel_date_start' => null], null, array_fill_keys(array_keys($sizes), 0), 'KLOOK'),
    ],
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
