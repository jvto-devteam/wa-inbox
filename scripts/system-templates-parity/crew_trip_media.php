<?php
// Parity: crew_trip_media — javavolcano-touroperator TripMediaCrew command (image to the crew group).

function build($value): string
{
    $dataSending = array();
// --- verbatim: javavolcano-touroperator/app/Console/Commands/TripMediaCrew.php:50-57 ---
          $crew = "";
          $no = 1;
          foreach ($value->guideDriver as $i => $data) {
            $isIjen = $data->guide_ijen == '1' ? " (Ijen Guide)" : "";
            $crew .= "*".$no.". ".$data->person->name.$isIjen."*\r\n";
            $no++;
          }
          $dataSending["message"] = "*Trip Media ".$value->user->name.",*\r\n\🌐 ".$value->media_link."\r\n\r\n🧗‍♂️ *CREW:*\r\n".$crew;
// --- end verbatim ---
    return $dataSending["message"];
}

$value = (object) [
    'user' => (object) ['name' => 'John Doe'],
    'media_link' => 'https://drive.google.com/drive/folders/example-trip-media',
    'guideDriver' => [
        (object) ['guide_ijen' => '0', 'person' => (object) ['name' => 'Budi Example']],
        (object) ['guide_ijen' => '1', 'person' => (object) ['name' => 'Agus Example']],
    ],
];

echo json_encode([
    [
        'variables' => [
            'customer_name' => 'John Doe',
            'media_link' => 'https://drive.google.com/drive/folders/example-trip-media',
            'crew_list' => "*1. Budi Example*\n*2. Agus Example (Ijen Guide)*",
        ],
        'text' => build($value),
    ],
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
