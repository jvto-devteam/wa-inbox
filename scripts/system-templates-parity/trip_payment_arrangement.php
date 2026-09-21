<?php
// Parity: trip_payment_arrangement — javavolcano-touroperator TripInformation command, the second
// message sent when the booking has wa_schedule_payment_content. The admin text is split on
// "{br}" and every piece gets "\r\n" appended; the template receives the same text with each
// "{br}" replaced by a newline (payment_content).

function build($value): string
{
// --- verbatim: javavolcano-touroperator/app/Console/Commands/TripInformation.php:104-114 ---
            $msg = explode('{br}',$value->wa_schedule_payment_content);
  
            $sendMessage = "";
            foreach ($msg as $i => $v) {
              $newLine = "\r\n";
              $message = $v == "" ? $newLine : $v.$newLine;
              $sendMessage.=$message;
            }
  
            
            $sendMessagePayment = "*Hello ".$value->user->name.",*\r\n\r\nWe would like to kindly request for your attention to the following payment arrangement for This Trip is : *".number_format($value->grand_total,0,',','.')." IDR*\r\n\r\n".$sendMessage."And our team will be happy to assist you with the payment process.\r\nLooking forward to meet you 😊\r\n\r\n📞 +62 822-4478-8833\r\n🏢 https://maps.app.goo.gl/TLgNey9iqSCM3QYh7\r\n\r\nBest Regards,\r\n*JAVA VOLCANO TOUR OPERATOR*";
// --- end verbatim ---
    return $sendMessagePayment;
}

$cases = [];
foreach ([
    "Deposit paid: 1.500.000 IDR{br}Remaining balance: 3.000.000 IDR{br}{br}Please settle the remaining balance in cash to our guide on Day 1.",
    "Please pay the full amount in cash to our guide on Day 1.",
] as $content) {
    $value = (object) [
        'user' => (object) ['name' => 'John Doe'],
        'grand_total' => 4500000,
        'wa_schedule_payment_content' => $content,
    ];
    $cases[] = [
        'variables' => [
            'customer_name' => 'John Doe',
            'grand_total' => '4.500.000',
            'payment_content' => str_replace('{br}', "\n", $content),
        ],
        'text' => build($value),
    ];
}

echo json_encode($cases, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
