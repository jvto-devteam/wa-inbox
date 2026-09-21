<?php
// Parity: crew_reminder_personal — javavolcano-touroperator TripReminderCrew command, the message
// sent to each crew member that has a phone number.

function build($value, $data): string
{
    $dataSending = array();
// --- verbatim: javavolcano-touroperator/app/Console/Commands/TripReminderCrew.php:56-56 ---
              $dataSending["message"] = "*Hello ".$data->person->name."*,\r\nPlease prepare for your schedule tomorrow.\r\n\r\n*Customer Name:* ".$value->user->name."\r\n*Pickup Location:* ".$value->pickup."\r\n*Pickup Time:* ".$value->pickup_time."\r\n\r\n📱 You can check more details at:\r\nhttps://crew-portal.javavolcano-touroperator.com/";
// --- end verbatim ---
    return $dataSending["message"];
}

$value = (object) ['user' => (object) ['name' => 'John Doe'], 'pickup' => 'Hotel Majapahit Surabaya', 'pickup_time' => '08:00'];
$data = (object) ['person' => (object) ['name' => 'Budi Example', 'phone' => '6282143403501']];

echo json_encode([
    [
        'variables' => ['crew_name' => 'Budi Example', 'customer_name' => 'John Doe', 'pickup' => 'Hotel Majapahit Surabaya', 'pickup_time' => '08:00'],
        'text' => build($value, $data),
    ],
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
