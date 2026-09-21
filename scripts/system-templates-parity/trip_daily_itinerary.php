<?php
// Parity: trip_daily_itinerary — javavolcano-touroperator Backoffice/SendWaController::test (GET
// /backoffice/send-wa/test, reads WaItinerary rows new-backoffice schedules for 20:00 each trip day).
// The caller passes `itinerary` = str_replace('{br}', "\n", $value->message).

function build(string $name, string $rawMessage): string
{
    $value = (object) ['message' => $rawMessage, 'user' => (object) ['name' => $name]];
// --- verbatim: javavolcano-touroperator/app/Http/Controllers/Backoffice/SendWaController.php:49-57 ---
          $msg = explode('{br}',$value->message);

          $sendMessage = "";
          foreach ($msg as $i => $v) {
            $newLine = "\r\n";
            $message = $v == "" ? $newLine : $v.$newLine;
            $sendMessage.=$message;
          }
          $dataSending["message"] = "*Hello ".$value->user->name.".*\r\n$sendMessage";
// --- end verbatim ---
    return $dataSending["message"];
}

$cases = [];
foreach ([
    ['John Doe', '*Day 1 - Ijen Crater*{br}Midnight hike to the blue fire.{br}{br}Pickup 00:30 at the hotel lobby.'],
    ['Jane Roe', '*Day 2 - Bromo*{br}Sunrise at Penanjakan.'],
] as [$name, $raw]) {
    $cases[] = [
        'variables' => ['customer_name' => $name, 'itinerary' => str_replace('{br}', "\n", $raw)],
        'text' => build($name, $raw),
    ];
}
echo json_encode($cases, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
