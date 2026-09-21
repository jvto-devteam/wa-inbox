<?php
// Parity: internal_bali_transport_reminder — javavolcano-touroperator ReminderBali::sendBaliNotif.

function build(array $data): string
{
    $dataSending = array();
// --- verbatim: javavolcano-touroperator/app/Console/Commands/ReminderBali.php:106-106 ---
      $dataSending["message"] = "*Reminder Transport Service Bali*\r\n\r\n🗓 Tanggal : " . $data['date'] . "\r\n\r\n🕤 Jam Pickup : " . $data['pickup_time'] . "\r\n\r\n👥 Tamu : " . $data['customer'] . " (" . $data['pax'] . " pax) \r\n\r\n🚗 Unit : " . $data['unit'] . "\r\n\r\n📍 Pickup : " . $data['pickup'] . "\r\n\r\n🏁 Drop : " . $data['drop'] . "\r\n\r\n✅ Tambahan : " . $data['others'];
// --- end verbatim ---
    return $dataSending["message"];
}

$toBali = [
    'date' => '12 October 2026',
    'pickup_time' => '09:30',
    'customer' => 'John Doe',
    'pax' => 2,
    'unit' => 'Avanza',
    'pickup' => 'Kuta Beach Hotel',
    'drop' => 'Ketapang',
    'others' => 'Porter x 1 & Ferry Ticket x 2',
];
$fromBali = [
    'date' => '14 October 2026',
    'pickup_time' => 'TO BE CONFIRMED',
    'customer' => 'John Doe',
    'pax' => 2,
    'unit' => 'Elf Short',
    'pickup' => 'Gilimanuk',
    'drop' => 'Transfer To Ubud. (TO BE CONFIRMED)',
    'others' => 'Porter x 1',
];
$vars = function (array $d) {
    return [
        'service_date' => $d['date'],
        'pickup_time' => $d['pickup_time'],
        'customer_name' => $d['customer'],
        'total_pax' => (string) $d['pax'],
        'vehicle' => $d['unit'],
        'pickup' => $d['pickup'],
        'drop' => $d['drop'],
        'extras' => $d['others'],
    ];
};

echo json_encode([
    ['variables' => $vars($toBali), 'text' => build($toBali)],
    ['variables' => $vars($fromBali), 'text' => build($fromBali)],
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
