<?php
// Parity: trip_information — javavolcano-touroperator TripInformation command (scheduled per booking).

function build($value): string
{
    $dataSending = array();
// --- verbatim: javavolcano-touroperator/app/Console/Commands/TripInformation.php:59-59 ---
          $dataSending['message'] = "🌄 *Let's Explore!*\r\n\r\nDear ".$value->user->name.",\r\n\r\n*Get ready for an adventure!*\r\n\r\n*Logistical Details* 📍\r\n- Pickup Time: ".$value->pickup_time."\r\n- Pickup Location: ".$value->pickup."\r\n\r\n*Important Reminders* ⚡\r\n- Arrive 10 minutes prior to pickup time\r\n- Bring necessary documents and gear\r\n\r\n*Your Adventure Awaits!* 💥\r\nAccess your trip details and documents:\r\n\r\n*Unified Portal*: https://javavolcano-touroperator.com/my-booking/".$value->url."\r\n\r\n*Need Help?*\r\nContact us:\r\n- WhatsApp: +62 822-4478-8833\r\n- Email: hello@javavolcano-touroperator.com\r\n\r\nBest regards,\r\nJVTO Team";
// --- end verbatim ---
    return $dataSending["message"];
}

$value = (object) [
    'user' => (object) ['name' => 'John Doe'],
    'pickup_time' => '08:00',
    'pickup' => 'Hotel Majapahit Surabaya',
    'url' => 'a1b2c3d4-example',
];

echo json_encode([
    [
        'variables' => ['customer_name' => 'John Doe', 'pickup_time' => '08:00', 'pickup' => 'Hotel Majapahit Surabaya', 'booking_slug' => 'a1b2c3d4-example'],
        'text' => build($value),
    ],
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
