<?php
// Parity: hotel_room_reservation — javavolcano-touroperator XenditController::invoiceSuccess, the
// message sent to the hotel's WhatsApp group per booked hotel night. Copies the meals text, the
// check-in/out dates and the message. The room loop (which saves BookRoomHotel rows) is not
// copied; $hotelRoomNames is set to what that loop concatenates ("<room> x <qty> + ...").

function build(string $d, string $l): string
{
    $bookHotel = (object) ['d' => $d, 'l' => $l];
    // In the original, $booking here is the query result from the booking-number lookup (a
    // different row than $book); its total_pax is what the meals line prints.
    $booking = (object) ['total_pax' => 2, 'travel_date_start' => '2026-10-12'];
    $bookingItinerary = (object) ['day' => 2];
    $book = (object) ['user' => (object) ['name' => 'John Doe'], 'total_pax' => 2];
    $packageHotel = (object) ['hotel' => (object) ['name' => 'Hotel Example Bromo', 'slug' => 'hotel-example-bromo']];
    $hotelRoomNames = 'Deluxe Double x 1 + Standard Twin x 1';
    $dataSending = array();
// --- verbatim: javavolcano-touroperator/app/Http/Controllers/thirdParty/XenditController.php:209-225 ---
                            $textMeals = "";
                            if ($bookHotel->d == '1' || $bookHotel->l == '1') {
                                $textMeals = "Include ";
                                if ($bookHotel->d == '1' && $bookHotel->l == '1') {
                                    $textMeals .= "Dinner & Lunch ";
                                } else if ($bookHotel->d == '1' && $bookHotel->l != '1') {
                                    $textMeals .= "Dinner ";
                                } else if ($bookHotel->d != '1' && $bookHotel->l == '1') {
                                    $textMeals .= "Lunch ";
                                }
                                $textMeals .= $booking->total_pax . " pax\r\n\r\n";
                            }
                            $checkIn = $bookingItinerary->day - 1;
                            $checkOut = $bookingItinerary->day;

                            $checkInDate = date('d F Y', strtotime($booking->travel_date_start . " +$checkIn days"));
                            $checkOutDate = date('d F Y', strtotime($booking->travel_date_start . " +$checkOut days"));
// --- end verbatim ---
// --- verbatim: javavolcano-touroperator/app/Http/Controllers/thirdParty/XenditController.php:251-252 ---
                                $customerName = $book->user->name . " (" . $book->total_pax . " PAX)";
                                $dataSending["message"] = "*📩 Room Reservation " . $packageHotel->hotel->name . "*\r\n\r\n🗓 Check In : $checkInDate\r\n\r\n🛫Check Out : $checkOutDate\r\n\r\n👥 Guest : $customerName\r\n\r\n🛏 Rooms : $hotelRoomNames\r\n\r\n" . $textMeals . "Cek detail Reservasi ⬇️⬇️\r\nhttps://partner.javavolcano-touroperator.com/reservation/" . $packageHotel->hotel->slug . "\r\n\r\nTerima kasih";
// --- end verbatim ---
    return $dataSending["message"];
}

$base = [
    'hotel_name' => 'Hotel Example Bromo',
    'check_in_date' => '13 October 2026',
    'check_out_date' => '14 October 2026',
    'guest' => 'John Doe (2 PAX)',
    'rooms' => 'Deluxe Double x 1 + Standard Twin x 1',
    'hotel_slug' => 'hotel-example-bromo',
];

echo json_encode([
    ['variables' => $base + ['meals' => 'Include Dinner & Lunch 2 pax'], 'text' => build('1', '1')],
    ['variables' => $base + ['meals' => 'Include Dinner 2 pax'], 'text' => build('1', '0')],
    ['variables' => $base + ['meals' => ''], 'text' => build('0', '0')],
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
