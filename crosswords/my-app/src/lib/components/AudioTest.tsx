"use client"

import PSSimpleFormProvider from "../hook-form/SimpleFormProvider"
import PSTextFieldAudio from "../hook-form/TextFieldAudio"




const TestForm = () => {

    return <>
        <PSTextFieldAudio name="something" label="Try" helperText="kjkjj"/>
    </>
}




const AudioTest = () => {



    return <>

        <PSSimpleFormProvider values={{}} onSubmit={(data) => {
            console.log(data)
        }}>
            <TestForm />

        </PSSimpleFormProvider>
    </>
}



export default AudioTest