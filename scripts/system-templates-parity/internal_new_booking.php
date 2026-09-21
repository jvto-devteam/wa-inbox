<?php
// Parity: internal_new_booking — javavolcano-touroperator XenditController::sendWaNotif (identical
// message text to frontend CheckoutController::sendWaNotif:857-862).

function build(array $wa): string
{
// --- verbatim: javavolcano-touroperator/app/Http/Controllers/thirdParty/XenditController.php:529-530 ---
            $isDrop = $wa['drop'] != '' ? "\r\n*Drop:* " . $wa['drop'] : "";
            $isSpecials = $wa['special_requirements'] != "" ?  "*Special Requirements:* " . $wa['special_requirements'] . "\r\n" : "";
// --- end verbatim ---
    $dataSending = array();
// --- verbatim: javavolcano-touroperator/app/Http/Controllers/thirdParty/XenditController.php:534-534 ---
            $dataSending["message"] = "*New Booking from Website*\r\n\r\n*Name:* $wa[name]\r\n*Package:* $wa[package_url]\r\n*Participants:* $wa[ttl_pax] pax\r\n*Trip Date:* $wa[trip_date]\r\n*Pickup:* $wa[pickup]" . $isDrop . "\r\n\r\n" . $isSpecials . "*Payment Method:* $wa[payment_method]";
// --- end verbatim ---
    return $dataSending["message"];
}

$full = [
    'name' => 'John Doe',
    'package_url' => 'https://javavolcano-touroperator.com/bromo-ijen-tour-3d2n',
    'ttl_pax' => '2',
    'trip_date' => '12 October 2026',
    'pickup' => 'Hotel Majapahit Surabaya 08:00',
    'drop' => 'Ketapang Harbour',
    'special_requirements' => 'Vegetarian meals for 1 guest',
    'payment_method' => 'Xendit',
];
$vars = function (array $wa) {
    return [
        'customer_name' => $wa['name'],
        'package_url' => $wa['package_url'],
        'total_pax' => $wa['ttl_pax'],
        'trip_date' => $wa['trip_date'],
        'pickup' => $wa['pickup'],
        'drop' => $wa['drop'],
        'special_requirements' => $wa['special_requirements'],
        'payment_method' => $wa['payment_method'],
    ];
};
$none = array_merge($full, ['drop' => '', 'special_requirements' => '']);
$dropOnly = array_merge($full, ['special_requirements' => '']);
$specialOnly = array_merge($full, ['drop' => '']);

echo json_encode([
    ['variables' => $vars($full), 'text' => build($full)],
    ['variables' => $vars($none), 'text' => build($none)],
    ['variables' => $vars($dropOnly), 'text' => build($dropOnly)],
    ['variables' => $vars($specialOnly), 'text' => build($specialOnly)],
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
