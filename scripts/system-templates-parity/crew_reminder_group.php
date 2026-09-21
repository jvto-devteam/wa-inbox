<?php
// Parity: crew_reminder_group — javavolcano-touroperator TripReminderCrew command, the group
// message (only for agent_id == 1). The crew-list loop is copied without the per-crew send
// (its curl call) that sits inside the same if-block.

function build($value): string
{
    $dataSending = array();
// --- verbatim: javavolcano-touroperator/app/Console/Commands/TripReminderCrew.php:49-51 ---
          $crew = "";
          foreach ($value->guideDriver as $i => $data) {
            if($data->person->phone){
// --- end verbatim ---
// --- verbatim: javavolcano-touroperator/app/Console/Commands/TripReminderCrew.php:52-54 ---
              $isIjen = $data->guide_ijen == '1' ? " (Ijen Guide)" : "";
              $coma = $i < count($value->guideDriver) - 1 ? ", " : "";
              $crew .= $data->person->name.$isIjen.$coma;
// --- end verbatim ---
            }
          }
// --- verbatim: javavolcano-touroperator/app/Console/Commands/TripReminderCrew.php:82-82 ---
            $dataSending["message"] = "*Reminder for tomorrow’s schedule*.\r\n\r\n*Customer Name:* ".$value->user->name."\r\n*Pickup Location:* ".$value->pickup."\r\n*Pickup Time:* ".$value->pickup_time."\r\n*Crews:* ".$crew."\r\n\r\n📱 Check more details at:\r\nhttps://crew-portal.javavolcano-touroperator.com/";
// --- end verbatim ---
    return $dataSending["message"];
}

$value = (object) [
    'user' => (object) ['name' => 'John Doe'],
    'pickup' => 'Hotel Majapahit Surabaya',
    'pickup_time' => '08:00',
    'guideDriver' => [
        (object) ['guide_ijen' => '0', 'person' => (object) ['name' => 'Budi Example', 'phone' => '6282143403501']],
        (object) ['guide_ijen' => '1', 'person' => (object) ['name' => 'Agus Example', 'phone' => '6282143403501']],
    ],
];

echo json_encode([
    [
        'variables' => [
            'customer_name' => 'John Doe',
            'pickup' => 'Hotel Majapahit Surabaya',
            'pickup_time' => '08:00',
            'crew_list' => 'Budi Example, Agus Example (Ijen Guide)',
        ],
        'text' => build($value),
    ],
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
