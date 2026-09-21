<?php
// Parity: internal_consent_completed — javavolcano-touroperator TypeformController::webhook.
// Only the "message" element of the original $dataSending array is copied (the others are config()).

function build(string $name): string
{
    $dataSending = [
// --- verbatim: javavolcano-touroperator/app/Http/Controllers/thirdParty/TypeformController.php:29-29 ---
            "message" => "$name has completed the consent form input", // Pesan dinamis
// --- end verbatim ---
    ];
    return $dataSending["message"];
}

echo json_encode([
    ['variables' => ['customer_name' => 'John Doe'], 'text' => build('John Doe')],
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
