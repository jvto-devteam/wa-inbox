<?php
// Parity: trip_concluded — javavolcano-touroperator TripMedia command. Line 53 builds an older
// message that line 54 overwrites before sending; only line 54 is ever sent.

function build($value): string
{
    $dataSending = array();
// --- verbatim: javavolcano-touroperator/app/Console/Commands/TripMedia.php:54-54 ---
          $dataSending['message'] = "Hello ".$value->user->name." 🌟\r\n\r\n*Your Journey with JVTO Concludes!* 🏜\r\n\r\nThank you so much for choosing *Java Volcano Tour Operator* for your adventure!\r\nWe truly hope you had a fun and unforgettable trip in Indonesia.\r\n\r\n📸 Your Trip Memories:\r\nAll the fantastic pictures from your trip are ready for you to view and download! Access them directly on your personalized trip dashboard:\r\n🌐 https://javavolcano-touroperator.com/my-booking/".$value->url."\r\n\r\n✍ Share Your Experience:\r\nYour feedback is invaluable to us and incredibly helpful to future travelers. Please take a moment to leave a review on Google or Trustpilot (link also available on portal).\r\n\r\nWe hope to welcome you on another adventure soon!\r\n\r\nMany thanks,\r\nThe JVTO Team";
// --- end verbatim ---
    return $dataSending["message"];
}

$value = (object) ['user' => (object) ['name' => 'John Doe'], 'url' => 'a1b2c3d4-example'];

echo json_encode([
    ['variables' => ['customer_name' => 'John Doe', 'booking_slug' => 'a1b2c3d4-example'], 'text' => build($value)],
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
