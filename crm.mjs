import axios from 'axios';

async function getUserToken(phone) {
    try {
        const response = await axios.post(`${process.env.CRM_URL}/auth/email-code/get-token`,
            {
                phone,
                "secret": process.env.EMAIL_CODE_AUTH_SECRET
            }
        );
        if (response.status === 200 && response.data && response.data.token) {
            return response.data.token;
        } else {
            console.error(`Failed to fetch token for ${phone}:`, response.data);
            return null;
        }
    } catch (error) {
        console.error(`Error fetching token for ${phone}:`, error.message);
        return null;
    }
}

async function initAuth(email) {
    try {
        const response = await axios.post(`${process.env.CRM_URL}/auth/email-code/init`, {
            email,
            "secret": process.env.EMAIL_CODE_AUTH_SECRET
        });
        return response.data? response.data.message : null;
    } catch (error) {
        console.error(`Error initializing auth for ${email}:`, error.message);
        return null;
    }
}

async function authenticate(email, phone, code) {
    try {
        const response = await axios.post(`${process.env.CRM_URL}/auth/email-code/authenticate`, {
            email,
            phone,
            code,
            "secret": process.env.EMAIL_CODE_AUTH_SECRET
        });
        return response.data ? response.data.token : null;
    } catch (error) {
        console.error(`Error exchanging code for token:`, error.message);
        return null;
    }
}

export {getUserToken, initAuth, authenticate}