# WhatsApp bot to help you chat with your CRM data

This bot builds conversational capabilities on top of an existing CRM that you can access via a web interface here: https://genezio-crm.app.genez.io/

It is using OpenAI for LLM capabilities, listens to messages from WhatsApp Business via a webhook, and replies using WhatsApp's APIs.

Handles two user modes: unauthenticated and authenticated.

When unauthenticated, it will guide the user to authenticate

When authenticated, it will call the CRM's APIs as defined in the swagger file and try to help the user achieve their goals.

See the code behind CRM in interacts with here: https://github.com/bogdanripa/Genezio-CRM/

Interact live with the WhatApp bot here: https://wa.me/40750266147

## Conversation example:

> Me: Hi, who are you?
> 
> Agent: Hello! I’m a virtual assistant created to help you with questions and updates related to your CRM system. First, I need to authenticate you. Can you please provide your email address so we can begin the authentication process?
>
> Me: Sure. My email address is b***@genezio.com
>
> Agent: It looks like that email address doesn’t exist in our system. Please create a new account on our website: genezio-crm.app.genez.io. After you’ve created an account, please return here to complete the authentication. If you need help, I’m here to assist!
>
> Me: Try with b***@genez.io then? Maybe that one works?
>
> Agent: An email has been sent to your address with an authentication code. Please send me the code you received to continue the authentication process.
>
> Me: One second
>
> Agent: Of course, take all the time you need! I’ll be waiting for the authentication code when you’re ready.
>
> Me: I received the code 1238266
>
> Agent: Authentication was successful! You’re now logged into our CRM system. How can I assist you further?
