export async function sleep(sec: number) {
    return new Promise((res) => {
        let countDown = sec;
        const interval = setInterval(() => {
            if (countDown > 0) {
                console.log(countDown);
                countDown -= 1;
            } else {
                interval.unref();
                res(undefined);
            }
        }, 1000);
    });
}
