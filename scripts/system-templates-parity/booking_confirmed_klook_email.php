<?php
// Parity: booking_confirmed_klook_email — javavolcano-touroperator KlookEmailExtractorController,
// customer confirmation after a Klook booking email is imported.

function build($user, $package, $booking): string
{
    $dataSending = array();
// --- verbatim: javavolcano-touroperator/app/Http/Controllers/KlookEmailExtractorController.php:643-643 ---
        $dataSending["message"] = "*Booking Confirmed!* ✅🎉\r\n\r\nDear ".$user->name.",\r\n\r\nWe're thrilled to confirm your booking! 🎉 Below are the details of your upcoming trip:\r\n\r\n*Your Booking Details*\r\n\r\n- *Tour Package*: ".$package->name."\r\n- *Number of Pax*: ".$booking->total_pax." Pax\r\n\r\n*Access Your Personalized Trip Dashboard* 📊\r\nhttps://javavolcano-touroperator.com/my-booking/".$booking->url."\r\n\r\n*What's Next?*\r\n- Your booking is confirmed, you can check your trip detail through Trip Dasbboard.\r\n\r\n*Need Help?*\r\nContact us:\r\n- WhatsApp: +62 822-4478-8833\r\n- Email: hello@javavolcano-touroperator.com\r\n\r\nLet's Get Ready to Explore! 🎉\r\nWe're looking forward to helping you create unforgettable memories!\r\n\r\nBest regards,\r\nJVTO Team 🚐";
// --- end verbatim ---
    return $dataSending["message"];
}

$user = (object) ['name' => 'John Doe'];
$package = (object) ['name' => 'Bromo Ijen Tour 3 Days 2 Nights'];
$booking = (object) ['total_pax' => 2, 'url' => 'a1b2c3d4-example'];

echo json_encode([
    [
        'variables' => ['customer_name' => 'John Doe', 'package_name' => 'Bromo Ijen Tour 3 Days 2 Nights', 'total_pax' => '2', 'booking_slug' => 'a1b2c3d4-example'],
        'text' => build($user, $package, $booking),
    ],
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
